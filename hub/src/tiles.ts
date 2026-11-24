import type { Db } from './db.js';

// Device tiles in the app (plan: checks and alerts): which devices the owner shows as status tiles in their room, and
// which reading (null for the device's summary in words). The only writer of `device_tiles`.

export interface DeviceTile {
  ieee: string;
  property: string | null;
  /** The owner's words for a yes/no reading's two states ("Otwarte" / "Zamknięte"); empty for the reading's own. */
  labels: { active: string; inactive: string };
}

export class DeviceTiles {
  constructor(private readonly db: Db) {}

  list(): DeviceTile[] {
    return (this.db.prepare('SELECT * FROM device_tiles ORDER BY rowid').all() as Array<Record<string, unknown>>).map(hydrate);
  }

  get(ieee: string): DeviceTile | null {
    const r = this.db.prepare('SELECT * FROM device_tiles WHERE ieee = ?').get(ieee.toLowerCase()) as Record<string, unknown> | undefined;
    return r ? hydrate(r) : null;
  }

  /** Shows or hides a device's tile; `property` picks one reading, else the summary. */
  set(ieee: string, on: boolean, property: string | null = null, labels: { active?: unknown; inactive?: unknown } = {}): DeviceTile | null {
    const id = ieee.toLowerCase();
    if (!on) {
      this.db.prepare('DELETE FROM device_tiles WHERE ieee = ?').run(id);
      return null;
    }
    if (property !== null && !/^[a-z0-9_]{1,60}$/i.test(property)) throw new Error('Unknown reading');
    const label = (v: unknown) => {
      const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
      if (t.length > 30) throw new Error('Words are at most 30 characters');
      return t || null;
    };
    this.db
      .prepare(
        'INSERT INTO device_tiles (ieee, property, active_label, inactive_label) VALUES (?, ?, ?, ?) ON CONFLICT(ieee) DO UPDATE SET property = excluded.property, active_label = excluded.active_label, inactive_label = excluded.inactive_label',
      )
      .run(id, property, label(labels.active), label(labels.inactive));
    return this.get(id);
  }
}

const hydrate = (r: Record<string, unknown>): DeviceTile => ({
  ieee: r.ieee as string,
  property: (r.property as string | null) ?? null,
  labels: { active: (r.active_label as string | null) ?? '', inactive: (r.inactive_label as string | null) ?? '' },
});
