import { transaction, type Db } from './db.js';
import { DeviceError, Devices, type DeviceRow } from './devices.js';
import { Rooms } from './rooms.js';

// A device's settings page saves name, icon and main room together: one transaction across the devices and rooms
// modules, each writing only its own data (0015).
export function saveDeviceSettings(db: Db, ieee: string, input: { name?: unknown; icon?: unknown; room?: unknown }): { before: DeviceRow; renamed?: string } {
  const devices = new Devices(db);
  const rooms = new Rooms(db);
  const { name, icon, room } = input;
  if (!devices.exists(ieee)) throw new DeviceError('Unknown device', 404);
  if (room !== undefined && room !== null && (typeof room !== 'string' || room.trim().length === 0 || room.length > 100)) {
    throw new DeviceError('Room must be 1 to 100 characters, or null for none');
  }
  return transaction(db, () => {
    const { before, name: renamed } = devices.update(ieee, { name, icon });
    if (room !== undefined) rooms.setMainRoom(ieee, typeof room === 'string' ? rooms.ensure(room.trim()) : null);
    return { before, ...(renamed ? { renamed } : {}) };
  });
}
