import type { Db } from './db.js';
import { ICON_NAME } from './device-icons.js';

// The device registry (0015): the only module that writes the `devices` table (except the room columns, which
// belong to rooms) and `channel_labels`. Everything else asks it.

export type DeviceStatus = 'pending' | 'joined';
export type DeviceSource = 'tuya-import' | 'paired';

export interface DeviceRow {
  ieee: string;
  name: string;
  room: string | null;
  roomId: number | null;
  status: DeviceStatus;
  source: DeviceSource;
}

export class DeviceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SELECT = 'SELECT d.ieee, d.name, r.name AS room, d.room_id AS roomId, d.status, d.source FROM devices d LEFT JOIN rooms r ON r.id = d.room_id';
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim();

export class Devices {
  constructor(private readonly db: Db) {}

  list(): DeviceRow[] {
    return this.db.prepare(`${SELECT} ORDER BY d.name`).all() as unknown as DeviceRow[];
  }

  get(ieee: string): DeviceRow | null {
    return (this.db.prepare(`${SELECT} WHERE d.ieee = ?`).get(ieee.toLowerCase()) as unknown as DeviceRow | undefined) ?? null;
  }

  exists(ieee: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM devices WHERE ieee = ?').get(ieee.toLowerCase()));
  }

  /** Names by address, for lists that show many devices. */
  names(): Map<string, string> {
    return new Map((this.db.prepare('SELECT ieee, name FROM devices').all() as Array<{ ieee: string; name: string }>).map((d) => [d.ieee, d.name]));
  }

  /** The owner's chosen icon and the one the Tuya import suggested. */
  icons(ieee: string): { icon: string | null; importIcon: string | null } {
    const row = this.db.prepare('SELECT icon, import_icon FROM devices WHERE ieee = ?').get(ieee) as { icon: string | null; import_icon: string | null } | undefined;
    return { icon: row?.icon ?? null, importIcon: row?.import_icon ?? null };
  }

  /** Renames a device and sets or clears (null) its icon. Returns the previous row. */
  update(ieee: string, input: { name?: unknown; icon?: unknown }): { before: DeviceRow; name?: string } {
    const before = this.get(ieee);
    if (!before) throw new DeviceError('Unknown device', 404);
    const { name, icon } = input;
    // A Material Symbols name, or null to go back to the automatic icon.
    if (icon !== undefined && icon !== null && (typeof icon !== 'string' || !ICON_NAME.test(icon))) throw new DeviceError('Choose an icon from the list');
    const cleanName = typeof name === 'string' ? clean(name) : undefined;
    if (name !== undefined && (!cleanName || cleanName.length > 100)) throw new DeviceError('Name must be 1 to 100 characters');
    if (cleanName && cleanName !== before.name) this.db.prepare('UPDATE devices SET name = ? WHERE ieee = ?').run(cleanName, before.ieee);
    if (icon !== undefined) this.db.prepare('UPDATE devices SET icon = ? WHERE ieee = ?').run(icon as string | null, before.ieee);
    return { before, ...(cleanName && cleanName !== before.name ? { name: cleanName } : {}) };
  }

  remove(ieee: string): void {
    this.db.prepare('DELETE FROM devices WHERE ieee = ?').run(ieee.toLowerCase());
  }

  // --- Joining (from the Zigbee bridge) and importing (from Tuya) ---

  /** A device that paired without being imported first. */
  addPaired(ieee: string, name: string): void {
    this.db.prepare("INSERT INTO devices (ieee, name, status, source) VALUES (?, ?, 'joined', 'paired')").run(ieee, name);
  }

  markJoined(ieee: string): void {
    this.db.prepare("UPDATE devices SET status = 'joined' WHERE ieee = ?").run(ieee);
  }

  /**
   * Adds or updates a device known from the Tuya app, to be paired later. Pending devices take the new name; joined
   * ones keep theirs and only gain an icon suggestion.
   */
  importPending(ieee: string, name: string, icon: string | null): 'imported' | 'updated' | 'kept' {
    const prior = this.db.prepare('SELECT status FROM devices WHERE ieee = ?').get(ieee) as { status: string } | undefined;
    if (!prior) {
      this.db.prepare("INSERT INTO devices (ieee, name, status, source, import_icon) VALUES (?, ?, 'pending', 'tuya-import', ?)").run(ieee, name, icon);
      return 'imported';
    }
    if (prior.status === 'pending') {
      this.db.prepare('UPDATE devices SET name = ?, import_icon = COALESCE(?, import_icon) WHERE ieee = ?').run(name, icon, ieee);
      return 'updated';
    }
    this.db.prepare('UPDATE devices SET import_icon = COALESCE(import_icon, ?) WHERE ieee = ?').run(icon, ieee);
    return 'kept';
  }

  // --- Channel labels: names for the channels of a multi-channel switch, such as spot, LED and regał ---

  labels(ieee: string): Record<string, string> {
    const rows = this.db.prepare('SELECT endpoint, label FROM channel_labels WHERE ieee = ? ORDER BY endpoint').all(ieee) as Array<{ endpoint: string; label: string }>;
    return Object.fromEntries(rows.map((r) => [r.endpoint, r.label]));
  }

  label(ieee: string, endpoint: string): string | undefined {
    return (this.db.prepare('SELECT label FROM channel_labels WHERE ieee = ? AND endpoint = ?').get(ieee, endpoint) as { label: string } | undefined)?.label;
  }

  /** Sets labels from an object of endpoint → label; an empty label removes it. */
  setLabels(ieee: string, body: unknown): Record<string, string> {
    ieee = ieee.toLowerCase();
    if (!this.exists(ieee)) throw new DeviceError('Unknown device', 404);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 16) throw new DeviceError('Send an object of endpoint labels');
    const entries = Object.entries(body as Record<string, unknown>);
    for (const [endpoint, label] of entries) {
      if (!/^[A-Za-z0-9_]{1,20}$/.test(endpoint)) throw new DeviceError(`Bad channel name ${endpoint}`);
      if (typeof label !== 'string' || label.length > 40) throw new DeviceError('Labels must be at most 40 characters');
    }
    this.db.exec('BEGIN');
    try {
      for (const [endpoint, label] of entries) {
        const value = clean(label as string);
        if (value) this.db.prepare('INSERT INTO channel_labels (ieee, endpoint, label) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET label = excluded.label').run(ieee, endpoint, value);
        else this.db.prepare('DELETE FROM channel_labels WHERE ieee = ? AND endpoint = ?').run(ieee, endpoint);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.labels(ieee);
  }

  /** Adds a label unless the channel already has one (the Tuya import). Returns whether it was added. */
  addLabelIfMissing(ieee: string, endpoint: string, label: string): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO channel_labels (ieee, endpoint, label) VALUES (?, ?, ?)').run(ieee, endpoint, label).changes > 0;
  }
}
