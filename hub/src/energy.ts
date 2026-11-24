import type { Db } from './db.js';
import { transaction } from './db.js';

// Energy totals (0014): per-device kWh per day, from the `energy` counter plugs and meters report. Only the increase
// between two reports is counted, so a counter that restarts (power cut, new device under the same address) or jumps
// implausibly doesn't create phantom consumption. The only writer of energy_daily and energy_counter.

/** More than this many kWh between two reports is not consumption but a different counter. */
const MAX_PLAUSIBLE_KWH = 50;
/** A restarted counter below this is counted from zero; above it, it's another device's total and only rebased. */
const RESTART_KWH = 1;

const day = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface EnergyTotals {
  today: number;
  month: number;
  days: Array<{ day: string; kwh: number }>;
}

export class Energy {
  constructor(private readonly db: Db) {}

  /** Records a counter reading in kWh. Returns the kWh added to today's total. */
  record(ieee: string, counter: number, at = Date.now()): number {
    if (!Number.isFinite(counter) || counter < 0) return 0;
    return transaction(this.db, () => {
      const last = this.db.prepare('SELECT value FROM energy_counter WHERE ieee = ?').get(ieee) as { value: number } | undefined;
      this.db.prepare('INSERT INTO energy_counter (ieee, value, at) VALUES (?, ?, ?) ON CONFLICT (ieee) DO UPDATE SET value = excluded.value, at = excluded.at').run(ieee, counter, at);
      if (!last) return 0;
      let delta = counter - last.value;
      if (delta < 0) delta = counter <= RESTART_KWH ? counter : 0;
      if (delta > MAX_PLAUSIBLE_KWH) delta = 0;
      if (delta > 0) {
        this.db
          .prepare('INSERT INTO energy_daily (ieee, day, kwh) VALUES (?, ?, ?) ON CONFLICT (ieee, day) DO UPDATE SET kwh = kwh + excluded.kwh')
          .run(ieee, day(at), delta);
      }
      return delta;
    });
  }

  /** Today, this month and the last 31 days, for one device or (without `ieee`) all together. */
  totals(ieee?: string, now = Date.now()): EnergyTotals {
    const today = day(now);
    const month = today.slice(0, 7);
    const from = day(now - 30 * 864e5);
    const where = ieee ? 'ieee = ? AND' : '';
    const args = ieee ? [ieee] : [];
    const days = this.db
      .prepare(`SELECT day, SUM(kwh) AS kwh FROM energy_daily WHERE ${where} day >= ? GROUP BY day ORDER BY day`)
      .all(...args, from) as Array<{ day: string; kwh: number }>;
    const sum = (prefix: string) =>
      (this.db.prepare(`SELECT COALESCE(SUM(kwh), 0) AS kwh FROM energy_daily WHERE ${where} day LIKE ?`).get(...args, `${prefix}%`) as { kwh: number }).kwh;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return { today: round(sum(today)), month: round(sum(month)), days: days.map((d) => ({ day: d.day, kwh: round(d.kwh) })) };
  }

  /** Devices with any energy recorded. */
  devices(): string[] {
    return (this.db.prepare('SELECT DISTINCT ieee FROM energy_daily').all() as Array<{ ieee: string }>).map((r) => r.ieee);
  }

  forget(ieee: string): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM energy_daily WHERE ieee = ?').run(ieee);
      this.db.prepare('DELETE FROM energy_counter WHERE ieee = ?').run(ieee);
    });
  }
}
