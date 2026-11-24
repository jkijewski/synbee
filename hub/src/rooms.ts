import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { Devices } from './devices.js';
import { ICON_NAME } from './device-icons.js';

// Rooms group devices for finding and choosing them (0012). Each device has one main room, or none; it can also be
// shown in more rooms, as a secondary option. Rooms don't switch anything: light groups do that.

export interface Room {
  id: number;
  name: string;
  icon: string;
  order: number;
  /** A colour the owner chose, as #rrggbb, or null to have one picked automatically. */
  color: string | null;
  /** Set when the room has a photo; changes with each upload, so browsers fetch the new one. */
  photo: number | null;
  /** Devices whose main room this is. */
  devices: string[];
  /** Devices from other rooms that are also shown here. */
  alsoDevices: string[];
}

export const DEFAULT_ROOM_ICON = 'meeting_room';

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name || name.length > 100) throw new RoomError('Room names are 1 to 100 characters');
  return name;
}

function cleanIcon(raw: unknown): string {
  if (typeof raw !== 'string' || !ICON_NAME.test(raw)) throw new RoomError('Choose an icon from the list');
  return raw;
}

export class Rooms {
  constructor(private readonly db: Db) {}

  list(): Room[] {
    const rooms = this.db.prepare('SELECT id, name, icon, sort_order, color, photo_version FROM rooms ORDER BY sort_order, name COLLATE NOCASE').all() as Array<{
      id: number;
      name: string;
      icon: string | null;
      sort_order: number;
      color: string | null;
      photo_version: number | null;
    }>;
    const main = this.db.prepare('SELECT ieee FROM devices WHERE room_id = ? ORDER BY name COLLATE NOCASE');
    const also = this.db.prepare('SELECT d.ieee FROM device_rooms x JOIN devices d ON d.ieee = x.ieee WHERE x.room_id = ? ORDER BY d.name COLLATE NOCASE');
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon ?? DEFAULT_ROOM_ICON,
      order: r.sort_order,
      color: r.color,
      photo: r.photo_version,
      devices: (main.all(r.id) as Array<{ ieee: string }>).map((d) => d.ieee),
      alsoDevices: (also.all(r.id) as Array<{ ieee: string }>).map((d) => d.ieee),
    }));
  }

  create(input: { name?: unknown; icon?: unknown }): Room {
    const name = cleanName(input.name);
    const icon = input.icon === undefined ? DEFAULT_ROOM_ICON : cleanIcon(input.icon);
    if (this.db.prepare('SELECT 1 FROM rooms WHERE name = ?').get(name)) throw new RoomError('A room with this name already exists', 409);
    const order = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM rooms').get() as { n: number }).n;
    const id = Number(this.db.prepare('INSERT INTO rooms (name, icon, sort_order) VALUES (?, ?, ?)').run(name, icon, order).lastInsertRowid);
    return this.list().find((r) => r.id === id)!;
  }

  update(id: number, input: { name?: unknown; icon?: unknown; color?: unknown }): Room {
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw new RoomError('Unknown room', 404);
    if (input.name !== undefined) {
      const name = cleanName(input.name);
      const other = this.db.prepare('SELECT id FROM rooms WHERE name = ?').get(name) as { id: number } | undefined;
      if (other && other.id !== id) throw new RoomError('A room with this name already exists', 409);
      this.db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(name, id);
    }
    if (input.icon !== undefined) this.db.prepare('UPDATE rooms SET icon = ? WHERE id = ?').run(cleanIcon(input.icon), id);
    if (input.color !== undefined) {
      if (input.color !== null && (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color))) throw new RoomError('Choose a colour as #rrggbb');
      this.db.prepare('UPDATE rooms SET color = ? WHERE id = ?').run(input.color === null ? null : (input.color as string).toLowerCase(), id);
    }
    return this.list().find((r) => r.id === id)!;
  }

  /** Puts the rooms in the given order; rooms not listed keep their place after them. */
  reorder(ids: unknown): Room[] {
    if (!Array.isArray(ids) || ids.some((x) => !Number.isInteger(x))) throw new RoomError('Send the room IDs in order');
    this.tx(() => ids.forEach((id, i) => this.db.prepare('UPDATE rooms SET sort_order = ? WHERE id = ?').run(i + 1, id)));
    return this.list();
  }

  /** The id of the room with this name, adding it if there is none (the Tuya import, choosing a room by name). */
  ensure(name: string, order = 0): number {
    const clean = cleanName(name);
    const row = this.db.prepare('SELECT id FROM rooms WHERE name = ?').get(clean) as { id: number } | undefined;
    return row ? row.id : Number(this.db.prepare('INSERT INTO rooms (name, sort_order) VALUES (?, ?)').run(clean, order).lastInsertRowid);
  }

  /** Sets a device's main room (null for none). A device is not also shown in its own main room. */
  setMainRoom(ieee: string, room: number | null): void {
    this.db.prepare('UPDATE devices SET room_id = ? WHERE ieee = ?').run(room, ieee);
    this.db.prepare('DELETE FROM device_rooms WHERE ieee = ? AND room_id IS ?').run(ieee, room);
  }

  /** Deletes a room. Its devices move to `moveTo`, or have no room when it is null. */
  remove(id: number, moveTo: unknown): void {
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw new RoomError('Unknown room', 404);
    let target: number | null = null;
    if (moveTo !== undefined && moveTo !== null) {
      if (!Number.isInteger(moveTo) || moveTo === id || !this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(moveTo as number)) throw new RoomError('Choose another room to move its devices to');
      target = moveTo as number;
    }
    this.tx(() => {
      if (target !== null) {
        // A device that was also shown in the target room now simply lives there.
        this.db.prepare('DELETE FROM device_rooms WHERE room_id = ? AND ieee IN (SELECT ieee FROM devices WHERE room_id = ?)').run(target, id);
      }
      this.db.prepare('UPDATE devices SET room_id = ? WHERE room_id = ?').run(target, id);
      this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    });
  }

  /** Sets a device's main room and the other rooms it is also shown in. */
  setDeviceRooms(ieee: string, input: { room?: unknown; also?: unknown }): { room: number | null; also: number[] } {
    if (!new Devices(this.db).exists(ieee)) throw new RoomError('Unknown device', 404);
    const exists = (x: unknown) => Number.isInteger(x) && Boolean(this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(x as number));
    const room = input.room === undefined ? ((this.db.prepare('SELECT room_id FROM devices WHERE ieee = ?').get(ieee) as { room_id: number | null }).room_id) : input.room;
    if (room !== null && !exists(room)) throw new RoomError('Unknown room');
    const also = input.also === undefined ? this.alsoRooms(ieee) : input.also;
    if (!Array.isArray(also) || also.length > 20 || !also.every(exists)) throw new RoomError('Choose existing rooms');
    const extra = [...new Set(also as number[])].filter((r) => r !== room);
    this.tx(() => {
      this.db.prepare('UPDATE devices SET room_id = ? WHERE ieee = ?').run(room as number | null, ieee);
      this.db.prepare('DELETE FROM device_rooms WHERE ieee = ?').run(ieee);
      for (const r of extra) this.db.prepare('INSERT INTO device_rooms (ieee, room_id) VALUES (?, ?)').run(ieee, r);
    });
    return { room: room as number | null, also: extra };
  }

  /** Moves several devices to one main room, or to none ("Not assigned"). Their extra rooms are kept. */
  moveDevices(ieees: unknown, room: unknown): { moved: number } {
    if (!Array.isArray(ieees) || ieees.length === 0 || ieees.length > 200) throw new RoomError('Choose the devices to move');
    const list = ieees.map((x) => (typeof x === 'string' ? x.toLowerCase() : ''));
    for (const ieee of list) if (!new Devices(this.db).exists(ieee)) throw new RoomError(`Unknown device ${ieee}`, 404);
    if (room !== null && !(Number.isInteger(room) && this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(room as number))) throw new RoomError('Unknown room');
    this.tx(() => {
      for (const ieee of list) {
        this.db.prepare('UPDATE devices SET room_id = ? WHERE ieee = ?').run(room as number | null, ieee);
        if (room !== null) this.db.prepare('DELETE FROM device_rooms WHERE ieee = ? AND room_id = ?').run(ieee, room as number);
      }
    });
    return { moved: list.length };
  }

  /**
   * Adds devices to a room without moving them: it becomes an extra room for devices that have a main room, and the
   * main room for devices that have none.
   */
  addDevices(ieees: unknown, room: unknown): { main: number; extra: number } {
    if (!Array.isArray(ieees) || ieees.length === 0 || ieees.length > 200) throw new RoomError('Choose the devices to add');
    if (!(Number.isInteger(room) && this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(room as number))) throw new RoomError('Unknown room');
    const list = ieees.map((x) => (typeof x === 'string' ? x.toLowerCase() : ''));
    let main = 0;
    let extra = 0;
    this.tx(() => {
      for (const ieee of list) {
        const row = this.db.prepare('SELECT room_id FROM devices WHERE ieee = ?').get(ieee) as { room_id: number | null } | undefined;
        if (!row) throw new RoomError(`Unknown device ${ieee}`, 404);
        if (row.room_id === null) {
          this.db.prepare('UPDATE devices SET room_id = ? WHERE ieee = ?').run(room as number, ieee);
          this.db.prepare('DELETE FROM device_rooms WHERE ieee = ? AND room_id = ?').run(ieee, room as number);
          main++;
        } else if (row.room_id !== room) {
          this.db.prepare('INSERT OR IGNORE INTO device_rooms (ieee, room_id) VALUES (?, ?)').run(ieee, room as number);
          extra++;
        }
      }
    });
    return { main, extra };
  }

  /** Takes a device out of one room: its main room (it becomes "Not assigned") or one of its extra rooms. */
  removeFromRoom(ieee: string, room: number): void {
    const row = this.db.prepare('SELECT room_id FROM devices WHERE ieee = ?').get(ieee) as { room_id: number | null } | undefined;
    if (!row) throw new RoomError('Unknown device', 404);
    if (row.room_id === room) this.db.prepare('UPDATE devices SET room_id = NULL WHERE ieee = ?').run(ieee);
    else if (this.db.prepare('DELETE FROM device_rooms WHERE ieee = ? AND room_id = ?').run(ieee, room).changes === 0) throw new RoomError('The device is not in that room', 404);
  }

  alsoRooms(ieee: string): number[] {
    return (this.db.prepare('SELECT room_id FROM device_rooms WHERE ieee = ? ORDER BY room_id').all(ieee) as Array<{ room_id: number }>).map((r) => r.room_id);
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

// Room photos: the browser scales them before upload (a thumbnail and a phone-sized picture), which also drops
// location and camera details. The hub only checks and stores them, in the data folder.
// A square thumbnail of 192 px (shown at 96 px on sharp screens) and a phone-sized picture of at most 1080 px.
export const PHOTO_SIZES = { thumb: 256 * 1024, mobile: 3 * 1024 * 1024 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZES;

function imageType(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export class RoomPhotos {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  private file(id: number, size: PhotoSize): string {
    return path.join(this.dir, `room-${id}-${size}.img`);
  }

  save(id: number, input: { thumb?: unknown; mobile?: unknown }): { photo: number } {
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw new RoomError('Unknown room', 404);
    const decoded: Partial<Record<PhotoSize, Buffer>> = {};
    for (const size of Object.keys(PHOTO_SIZES) as PhotoSize[]) {
      const raw = input[size];
      if (typeof raw !== 'string') throw new RoomError('Send the photo as a thumbnail and a phone-sized picture');
      const data = Buffer.from(raw, 'base64');
      if (data.length === 0 || data.length > PHOTO_SIZES[size]) throw new RoomError(`The ${size} picture is too large`);
      if (!imageType(data)) throw new RoomError('Use a JPEG, PNG or WebP picture');
      decoded[size] = data;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    for (const [size, data] of Object.entries(decoded)) fs.writeFileSync(this.file(id, size as PhotoSize), data);
    const version = Date.now();
    this.db.prepare('UPDATE rooms SET photo_version = ? WHERE id = ?').run(version, id);
    return { photo: version };
  }

  read(id: number, size: PhotoSize): { type: string; data: Buffer } | null {
    try {
      const data = fs.readFileSync(this.file(id, size));
      const type = imageType(data);
      return type ? { type, data } : null;
    } catch {
      return null;
    }
  }

  remove(id: number): void {
    for (const size of Object.keys(PHOTO_SIZES) as PhotoSize[]) fs.rmSync(this.file(id, size), { force: true });
    this.db.prepare('UPDATE rooms SET photo_version = NULL WHERE id = ?').run(id);
  }
}
