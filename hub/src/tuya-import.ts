import type { Db } from './db.js';
import { Devices } from './devices.js';
import { Rooms } from './rooms.js';

// Imports names (and rooms, if present) from a tinytuya `devices.json` listing.
// Only the fields read below are used; local keys and every other field are ignored and never stored.

export interface ImportResult {
  imported: Array<{ ieee: string; name: string }>;
  updated: Array<{ ieee: string; name: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

const MAX_ENTRIES = 500;
const MAX_NAME = 100;

export function ieeeFromNodeId(nodeId: string): string | null {
  const hex = nodeId.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{16}$/.test(hex) ? `0x${hex}` : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t.length > 0 ? t.slice(0, MAX_NAME) : null;
}

export function parseListing(raw: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  if (!Array.isArray(data)) throw new ImportError('Expected a list of devices.');
  if (data.length > MAX_ENTRIES) throw new ImportError(`Too many entries (more than ${MAX_ENTRIES}).`);
  return data;
}

export class ImportError extends Error {}

export function importTuyaListing(db: Db, entries: unknown[]): ImportResult {
  const result: ImportResult = { imported: [], updated: [], skipped: [] };
  const devices = new Devices(db);
  const rooms = new Rooms(db);

  db.exec('BEGIN');
  try {
    for (const entry of entries) {
      const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const name = text(e.name) ?? '(unnamed)';
      const nodeId = typeof e.node_id === 'string' ? e.node_id : null;
      if (!nodeId) {
        result.skipped.push({ name, reason: e.sub === false ? 'gateway, not a Zigbee device' : 'no Zigbee address (node_id)' });
        continue;
      }
      const ieee = ieeeFromNodeId(nodeId);
      if (!ieee) {
        result.skipped.push({ name, reason: 'node_id is not a 16-digit Zigbee address' });
        continue;
      }
      const roomName = text(e.room) ?? text(e.room_name);
      const roomId = roomName ? rooms.ensure(roomName) : null;
      const icon = typeof e.icon === 'string' && /^[a-z0-9_]{1,40}$/.test(e.icon) ? e.icon : null;
      const outcome = devices.importPending(ieee, name, icon);
      // A paired device keeps its name and room; a pending one takes the room from Tuya when there is one.
      if (outcome !== 'kept' && roomId !== null) rooms.setMainRoom(ieee, roomId);
      if (outcome === 'imported') result.imported.push({ ieee, name });
      else if (outcome === 'updated') result.updated.push({ ieee, name });
      else result.skipped.push({ name, reason: 'already paired; its name is kept' });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return result;
}
