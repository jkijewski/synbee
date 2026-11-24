import type { Db } from './db.js';
import { Devices } from './devices.js';
import { flattenExposes, type ExposedProperty } from './exposes.js';
import type { DeviceControl } from './ports.js';

// Sensor groups (plan: checks and alerts): a named set of yes/no sensors of one kind, such as all windows, read as
// one state in words ("All closed", "2 of 5 open: Kitchen, Bedroom"). Used by status tiles, automations (WHEN and
// IF) and checks. The only writer of `sensor_groups` and `sensor_group_members`.

export type SensorKind = 'contact' | 'leak' | 'smoke' | 'motion' | 'lock' | 'binary';
/** How many of a group's sensors are active (open, wet, motion, unlocked…): none, some or all. */
export type SensorGroupValue = 'none' | 'some' | 'all';
export type TileLevel = 'fine' | 'info' | 'warning' | 'alarm';

export interface SensorMember {
  ieee: string;
  property: string;
  name?: string;
}

export interface SensorGroup {
  id: number;
  name: string;
  kind: SensorKind;
  /** The room whose page shows its tile in the app; null for the "Other" page. */
  roomId: number | null;
  /** Whether the app shows it as a status tile. */
  tile: boolean;
  /** The owner's words for an active and an inactive sensor ("open" / "closed"); empty for the kind's own. */
  labels: { active: string; inactive: string };
  members: SensorMember[];
}

export interface SensorGroupStatus {
  value: SensorGroupValue | null;
  /** "All closed", "2 of 5 open: Kitchen, Bedroom", "1 offline". */
  text: string;
  level: TileLevel;
  /** The active members' names, then those without a known value. */
  active: Array<{ ieee: string; name: string }>;
  unknown: Array<{ ieee: string; name: string }>;
}

/** Words for each kind: what an active sensor is, and what an inactive one is. */
export const KIND_WORDS: Record<SensorKind, { active: string; inactive: string }> = {
  contact: { active: 'open', inactive: 'closed' },
  leak: { active: 'wet', inactive: 'dry' },
  smoke: { active: 'smoke', inactive: 'clear' },
  motion: { active: 'motion', inactive: 'clear' },
  lock: { active: 'unlocked', inactive: 'locked' },
  binary: { active: 'on', inactive: 'off' },
};

/** The level of an active sensor of a kind: an open door is a warning, a leak an alarm. */
export const ACTIVE_LEVEL: Record<SensorKind, TileLevel> = { contact: 'warning', leak: 'alarm', smoke: 'alarm', motion: 'info', lock: 'warning', binary: 'info' };

/** The kind of a sensor property, from its name. */
export function kindOf(property: string): SensorKind {
  if (property === 'contact') return 'contact';
  if (property === 'water_leak') return 'leak';
  if (property === 'smoke' || property === 'gas' || property === 'carbon_monoxide') return 'smoke';
  if (property === 'occupancy' || property === 'presence') return 'motion';
  if (property === 'lock_state' || property === 'lock') return 'lock';
  return 'binary';
}

/** Whether a sensor's value means active (open, wet, motion, unlocked…), or undefined when unknown. */
export function isActive(kind: SensorKind, prop: ExposedProperty | undefined, value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  // Zigbee2MQTT's contact is true while the magnet is near, so open is false.
  if (kind === 'contact') return value === false;
  if (kind === 'lock') return typeof value === 'string' ? /^unlock/i.test(value) : value === false;
  if (prop?.valueOn !== undefined) return value === prop.valueOn;
  return value === true || value === 'ON';
}

export class SensorGroupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const IEEE = /^0x[0-9a-f]{16}$/;

export class SensorGroups {
  constructor(
    private readonly db: Db,
    private readonly control?: Pick<DeviceControl, 'deviceState' | 'knownDevices' | 'isOnline'>,
  ) {}

  list(): SensorGroup[] {
    return (this.db.prepare('SELECT * FROM sensor_groups ORDER BY name').all() as Array<Record<string, unknown>>).map((r) => this.hydrate(r));
  }

  get(id: number): SensorGroup | null {
    const r = this.db.prepare('SELECT * FROM sensor_groups WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.hydrate(r) : null;
  }

  create(input: unknown): SensorGroup {
    const g = this.validate(input);
    try {
      return this.tx(() => {
        const id = Number(
          this.db.prepare('INSERT INTO sensor_groups (name, kind, room_id, tile, active_label, inactive_label) VALUES (?, ?, ?, ?, ?, ?)').run(g.name, g.kind, g.roomId, Number(g.tile), g.labels.active || null, g.labels.inactive || null).lastInsertRowid,
        );
        this.writeMembers(id, g.members);
        return this.get(id)!;
      });
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new SensorGroupError(`A sensor group named "${g.name}" already exists`, 409);
      throw err;
    }
  }

  update(id: number, input: unknown): SensorGroup {
    if (!this.get(id)) throw new SensorGroupError('Unknown sensor group', 404);
    const g = this.validate(input);
    try {
      return this.tx(() => {
        this.db.prepare('UPDATE sensor_groups SET name = ?, kind = ?, room_id = ?, tile = ?, active_label = ?, inactive_label = ? WHERE id = ?').run(g.name, g.kind, g.roomId, Number(g.tile), g.labels.active || null, g.labels.inactive || null, id);
        this.db.prepare('DELETE FROM sensor_group_members WHERE group_id = ?').run(id);
        this.writeMembers(id, g.members);
        return this.get(id)!;
      });
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new SensorGroupError(`A sensor group named "${g.name}" already exists`, 409);
      throw err;
    }
  }

  remove(id: number): void {
    if (this.db.prepare('DELETE FROM sensor_groups WHERE id = ?').run(id).changes === 0) throw new SensorGroupError('Unknown sensor group', 404);
  }

  private prop(ieee: string, property: string): ExposedProperty | undefined {
    return flattenExposes(this.control?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee)?.definition?.exposes).find((p) => p.property === property);
  }

  /** The group's state now, in words. */
  status(id: number): SensorGroupStatus | null {
    const g = this.get(id);
    if (!g) return null;
    const words = this.words(g);
    const active: SensorGroupStatus['active'] = [];
    const unknown: SensorGroupStatus['unknown'] = [];
    let known = 0;
    for (const m of g.members) {
      const name = m.name ?? m.ieee;
      const online = this.control?.isOnline(m.ieee);
      const a = online === false ? undefined : isActive(g.kind, this.prop(m.ieee, m.property), this.control?.deviceState(m.ieee)?.[m.property]);
      if (a === undefined) unknown.push({ ieee: m.ieee, name });
      else {
        known += 1;
        if (a) active.push({ ieee: m.ieee, name });
      }
    }
    const total = g.members.length;
    const value: SensorGroupValue | null = known === 0 ? null : active.length === 0 ? 'none' : active.length === known && unknown.length === 0 ? 'all' : 'some';
    // One sensor reads as its state alone ("Open"); several as how many ("All closed", "2 of 5 open: Kitchen, Hall").
    const main =
      value === null
        ? 'Unknown'
        : total === 1
          ? capitalise(value === 'none' ? words.inactive : words.active)
          : value === 'none'
            ? `All ${words.inactive}`
            : value === 'all'
              ? `All ${total} ${words.active}`
              : `${active.length} of ${total} ${words.active}: ${active.map((a) => a.name).join(', ')}`;
    const text = unknown.length > 0 && value !== null ? `${main} · ${unknown.length} not reporting` : main;
    const level: TileLevel = value === 'some' || value === 'all' ? ACTIVE_LEVEL[g.kind] : value === null ? 'info' : 'fine';
    return { value, text, level, active, unknown };
  }

  /** The group's words for active and inactive: the owner's, else its kind's. */
  words(g: Pick<SensorGroup, 'kind' | 'labels'>): { active: string; inactive: string } {
    const k = KIND_WORDS[g.kind];
    return { active: g.labels.active || k.active, inactive: g.labels.inactive || k.inactive };
  }

  /** The value as a condition or trigger reads it ("none" = all inactive), null when nothing is known. */
  value(id: number): SensorGroupValue | null {
    return this.status(id)?.value ?? null;
  }

  /** Groups a device belongs to, to react to its changes. */
  groupsOf(ieee: string): number[] {
    return (this.db.prepare('SELECT DISTINCT group_id AS id FROM sensor_group_members WHERE ieee = ?').all(ieee.toLowerCase()) as Array<{ id: number }>).map((r) => r.id);
  }

  private validate(input: unknown): Omit<SensorGroup, 'id'> {
    if (!input || typeof input !== 'object') throw new SensorGroupError('Send a sensor group');
    const i = input as Record<string, unknown>;
    const name = typeof i.name === 'string' ? i.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    if (!name || name.length > 60) throw new SensorGroupError('Name must be 1 to 60 characters');
    if (!Array.isArray(i.members) || i.members.length === 0 || i.members.length > 50) throw new SensorGroupError('Choose 1 to 50 sensors');
    const members = i.members.map((raw, n) => {
      const m = (raw ?? {}) as Record<string, unknown>;
      const ieee = typeof m.ieee === 'string' ? m.ieee.toLowerCase() : '';
      const property = typeof m.property === 'string' ? m.property : '';
      if (!IEEE.test(ieee) || !/^[a-z0-9_]{1,60}$/i.test(property)) throw new SensorGroupError(`Sensor ${n + 1}: choose a device and its sensor`);
      if (!new Devices(this.db).get(ieee)) throw new SensorGroupError(`Sensor ${n + 1}: unknown device`);
      const prop = this.prop(ieee, property);
      if (this.control && (!prop || prop.type !== 'binary')) throw new SensorGroupError(`Sensor ${n + 1}: ${property} isn't a yes/no reading of that device`);
      return { ieee, property };
    });
    const kinds = new Set(members.map((m) => kindOf(m.property)));
    const kind: SensorKind = kinds.size === 1 ? [...kinds][0]! : 'binary';
    const roomId = i.roomId === null || i.roomId === undefined ? null : Number(i.roomId);
    if (roomId !== null && (!Number.isInteger(roomId) || !this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId))) throw new SensorGroupError('Unknown room');
    const label = (v: unknown, what: string) => {
      const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
      if (t.length > 30) throw new SensorGroupError(`${what}: at most 30 characters`);
      return t;
    };
    const l = (i.labels ?? {}) as Record<string, unknown>;
    return { name, kind, roomId, tile: i.tile !== false, labels: { active: label(l.active, 'Word when active'), inactive: label(l.inactive, 'Word when not active') }, members };
  }

  private writeMembers(id: number, members: SensorMember[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO sensor_group_members (group_id, ieee, property) VALUES (?, ?, ?)');
    for (const m of members) insert.run(id, m.ieee, m.property);
  }

  private hydrate(r: Record<string, unknown>): SensorGroup {
    const devices = new Devices(this.db);
    const members = (this.db.prepare('SELECT ieee, property FROM sensor_group_members WHERE group_id = ? ORDER BY rowid').all(r.id as number) as Array<{ ieee: string; property: string }>).map(
      (m) => ({ ...m, name: devices.get(m.ieee)?.name ?? m.ieee }),
    );
    return {
      id: r.id as number,
      name: r.name as string,
      kind: r.kind as SensorKind,
      roomId: (r.room_id as number | null) ?? null,
      tile: r.tile === 1,
      labels: { active: (r.active_label as string | null) ?? '', inactive: (r.inactive_label as string | null) ?? '' },
      members,
    };
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
