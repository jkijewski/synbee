import type { Db } from './db.js';
import { transaction } from './db.js';
import type { ExposedProperty } from './exposes.js';
import { Settings } from './settings.js';

// Reading history (0014): every numeric or yes/no report is kept raw for a week, as 5-minute averages for 90 days and
// as hourly averages for two years, all configurable and size-capped. It also records when each current value began,
// for "has been … for N minutes" conditions. The only writer of readings_*, value_since.

export const HISTORY_KEY = 'history';
export interface HistorySettings {
  rawDays: number;
  fiveMinuteDays: number;
  hourlyDays: number;
  /** Upper bound for raw rows; the oldest go first when it is reached. */
  maxRawRows: number;
}
export const DEFAULT_HISTORY: HistorySettings = { rawDays: 7, fiveMinuteDays: 90, hourlyDays: 730, maxRawRows: 2_000_000 };

export type HistoryRange = '24h' | '7d' | '30d' | '1y';
const RANGE_MS: Record<HistoryRange, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '1y': 365 * 864e5 };
const FIVE_MIN = 300_000;
const HOUR = 3_600_000;
/** The same value reported again within this time isn't stored again. */
const REPEAT_MS = 60_000;

export interface Point {
  at: number;
  value: number;
  min?: number;
  max?: number;
}

/** Which properties are worth keeping: readable numbers and yes/no values that aren't settings. */
export function recorded(p: ExposedProperty): boolean {
  return p.readable && (p.type === 'numeric' || p.type === 'binary') && p.category !== 'config' && p.property !== 'linkquality';
}

/** A report as a number: yes/no values become 1/0. */
export function asNumber(p: ExposedProperty, value: unknown): number | null {
  if (p.type === 'numeric') return typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (value === (p.valueOn ?? true)) return 1;
  if (value === (p.valueOff ?? false)) return 0;
  return null;
}

export class History {
  private readonly lastStored = new Map<string, { value: number; at: number }>();

  constructor(private readonly db: Db) {}

  settings(): HistorySettings {
    return { ...DEFAULT_HISTORY, ...new Settings(this.db).get<Partial<HistorySettings>>(HISTORY_KEY, {}) };
  }

  saveSettings(input: unknown): HistorySettings {
    const i = (input ?? {}) as Record<string, unknown>;
    const whole = (v: unknown, lo: number, hi: number, name: string) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${name} must be a whole number from ${lo} to ${hi}`);
      return v;
    };
    const current = this.settings();
    const next: HistorySettings = {
      rawDays: whole(i.rawDays ?? current.rawDays, 1, 90, 'Raw days'),
      fiveMinuteDays: whole(i.fiveMinuteDays ?? current.fiveMinuteDays, 7, 730, '5-minute days'),
      hourlyDays: whole(i.hourlyDays ?? current.hourlyDays, 30, 3650, 'Hourly days'),
      maxRawRows: whole(i.maxRawRows ?? current.maxRawRows, 100_000, 50_000_000, 'Maximum raw rows'),
    };
    new Settings(this.db).set(HISTORY_KEY, next);
    return next;
  }

  /** Records one device report. `props` are the device's exposed properties. */
  record(ieee: string, props: ExposedProperty[], state: Record<string, unknown>, changed: string[], at = Date.now()): void {
    const insert = this.db.prepare('INSERT INTO readings_raw (ieee, property, at, value) VALUES (?, ?, ?, ?)');
    const since = this.db.prepare(
      'INSERT INTO value_since (ieee, property, value_json, since) VALUES (?, ?, ?, ?) ON CONFLICT (ieee, property) DO UPDATE SET value_json = excluded.value_json, since = excluded.since WHERE value_since.value_json != excluded.value_json',
    );
    transaction(this.db, () => {
      for (const p of props) {
        if (!(p.property in state)) continue;
        const raw = state[p.property];
        if (raw !== undefined && (p.type === 'binary' || p.type === 'enum' || p.type === 'numeric')) since.run(ieee, p.property, JSON.stringify(raw), at);
        if (!recorded(p)) continue;
        const value = asNumber(p, raw);
        if (value === null) continue;
        const key = `${ieee}/${p.property}`;
        const last = this.lastStored.get(key);
        if (last && last.value === value && at - last.at < REPEAT_MS && !changed.includes(p.property)) continue;
        insert.run(ieee, p.property, at, value);
        this.lastStored.set(key, { value, at });
      }
    });
  }

  /** When the property's current value began, and what it is (as stored JSON), or null if never seen. */
  since(ieee: string, property: string): { value: unknown; since: number } | null {
    const row = this.db.prepare('SELECT value_json, since FROM value_since WHERE ieee = ? AND property = ?').get(ieee, property) as { value_json: string; since: number } | undefined;
    return row ? { value: JSON.parse(row.value_json) as unknown, since: row.since } : null;
  }

  /**
   * Whether `holds` was true for every reading of the last `minutes`, including the one in force when that time began.
   * Uses raw history for recorded values (numbers, yes/no as 1/0) and the value's start time for the rest.
   */
  heldFor(ieee: string, property: string, minutes: number, holds: (value: unknown) => boolean, decode: (n: number) => unknown, now = Date.now()): boolean {
    const from = now - minutes * 60_000;
    const before = this.db.prepare('SELECT value FROM readings_raw WHERE ieee = ? AND property = ? AND at <= ? ORDER BY at DESC LIMIT 1').get(ieee, property, from) as
      | { value: number }
      | undefined;
    if (before) {
      const during = this.db.prepare('SELECT value FROM readings_raw WHERE ieee = ? AND property = ? AND at > ? ORDER BY at').all(ieee, property, from) as Array<{ value: number }>;
      return [before, ...during].every((r) => holds(decode(r.value)));
    }
    const since = this.since(ieee, property);
    return since !== null && since.since <= from && holds(since.value);
  }

  /** A series for a graph: raw for a day, 5-minute averages for a week, hourly beyond. */
  series(ieee: string, property: string, range: HistoryRange, now = Date.now()): Point[] {
    const from = now - RANGE_MS[range];
    if (range === '24h') {
      return this.db.prepare('SELECT at, value FROM readings_raw WHERE ieee = ? AND property = ? AND at >= ? ORDER BY at').all(ieee, property, from) as unknown as Point[];
    }
    // Older buckets come from the rollups; the newest, not yet rolled up, from raw rows.
    const table = range === '7d' ? 'readings_5m' : 'readings_1h';
    const size = range === '7d' ? FIVE_MIN : HOUR;
    const rolled = this.db
      .prepare(`SELECT bucket AS at, avg AS value, min, max FROM ${table} WHERE ieee = ? AND property = ? AND bucket >= ? ORDER BY bucket`)
      .all(ieee, property, from) as unknown as Point[];
    const after = rolled.length ? rolled[rolled.length - 1]!.at + size : from;
    const recent = this.db
      .prepare(`SELECT (at / ${size}) * ${size} AS at, AVG(value) AS value, MIN(value) AS min, MAX(value) AS max FROM readings_raw WHERE ieee = ? AND property = ? AND at >= ? GROUP BY at / ${size} ORDER BY 1`)
      .all(ieee, property, after) as unknown as Point[];
    return [...rolled, ...recent];
  }

  /** Which properties of a device have any history, for choosing graphs. */
  properties(ieee: string): string[] {
    return (this.db.prepare('SELECT DISTINCT property FROM readings_raw WHERE ieee = ? UNION SELECT DISTINCT property FROM readings_1h WHERE ieee = ?').all(ieee, ieee) as Array<{ property: string }>).map((r) => r.property);
  }

  /** Rolls raw rows up into 5-minute and hourly buckets (completed ones only) and deletes what is past retention. */
  maintain(now = Date.now()): { rawDeleted: number } {
    const s = this.settings();
    const roll = (table: string, size: number) =>
      this.db
        .prepare(
          `INSERT INTO ${table} (ieee, property, bucket, avg, min, max, n)
           SELECT ieee, property, (at / ${size}) * ${size}, AVG(value), MIN(value), MAX(value), COUNT(*) FROM readings_raw
           WHERE at < ? GROUP BY ieee, property, at / ${size}
           ON CONFLICT (ieee, property, bucket) DO UPDATE SET avg = excluded.avg, min = excluded.min, max = excluded.max, n = excluded.n`,
        )
        .run(Math.floor(now / size) * size);
    return transaction(this.db, () => {
      // Rolling up from raw keeps averages exact while raw rows exist; buckets whose raw rows are gone stay as they were.
      roll('readings_5m', FIVE_MIN);
      roll('readings_1h', HOUR);
      let rawDeleted = Number(this.db.prepare('DELETE FROM readings_raw WHERE at < ?').run(now - s.rawDays * 864e5).changes);
      this.db.prepare('DELETE FROM readings_5m WHERE bucket < ?').run(now - s.fiveMinuteDays * 864e5);
      this.db.prepare('DELETE FROM readings_1h WHERE bucket < ?').run(now - s.hourlyDays * 864e5);
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM readings_raw').get() as { n: number }).n;
      if (count > s.maxRawRows) {
        rawDeleted += Number(
          this.db.prepare('DELETE FROM readings_raw WHERE rowid IN (SELECT rowid FROM readings_raw ORDER BY at LIMIT ?)').run(count - s.maxRawRows).changes,
        );
      }
      return { rawDeleted };
    });
  }

  /** Forgets a device's history, when the device is removed. */
  forget(ieee: string): void {
    transaction(this.db, () => {
      for (const t of ['readings_raw', 'readings_5m', 'readings_1h', 'value_since']) this.db.prepare(`DELETE FROM ${t} WHERE ieee = ?`).run(ieee);
    });
  }
}
