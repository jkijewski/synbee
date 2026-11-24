import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { DeviceError, Devices } from '../src/devices.js';
import { Rooms } from '../src/rooms.js';

// The device registry owns the devices and channel_labels tables (0015); other modules go through it.
describe('device registry', () => {
  const IEEE = '0xa4c1380000000001';

  it('imports pending devices, keeps paired ones, and marks them joined', () => {
    const devices = new Devices(openDatabase(':memory:'));
    expect(devices.importPending(IEEE, 'biurko', 'toggle_on')).toBe('imported');
    expect(devices.importPending(IEEE, 'biurko robocze', null)).toBe('updated');
    expect(devices.get(IEEE)).toMatchObject({ name: 'biurko robocze', status: 'pending', source: 'tuya-import' });
    expect(devices.icons(IEEE)).toEqual({ icon: null, importIcon: 'toggle_on' });
    devices.markJoined(IEEE);
    expect(devices.importPending(IEEE, 'other name', 'lightbulb')).toBe('kept');
    expect(devices.get(IEEE)?.name).toBe('biurko robocze');
    devices.addPaired('0x0000000000000001', 'new_bulb');
    expect(devices.list().map((d) => d.name)).toEqual(['biurko robocze', 'new_bulb']);
  });

  it('validates names, icons and channel labels', () => {
    const devices = new Devices(openDatabase(':memory:'));
    devices.addPaired(IEEE, 'desk');
    expect(() => devices.update(IEEE, { name: '' })).toThrow(DeviceError);
    expect(() => devices.update(IEEE, { icon: 'not an icon!' })).toThrow(/icon/);
    expect(devices.update(IEEE, { name: ' biurko ', icon: 'lightbulb' })).toMatchObject({ name: 'biurko' });
    expect(devices.setLabels(IEEE, { l1: 'spot', l2: 'LED' })).toEqual({ l1: 'spot', l2: 'LED' });
    expect(devices.setLabels(IEEE, { l2: '' })).toEqual({ l1: 'spot' });
    expect(devices.addLabelIfMissing(IEEE, 'l1', 'other')).toBe(false);
    expect(devices.label(IEEE, 'l1')).toBe('spot');
    expect(() => devices.setLabels('0x0000000000000002', { l1: 'x' })).toThrow(/Unknown device/);
    expect(() => devices.setLabels(IEEE, { 'bad name': 'x' })).toThrow(/Bad channel/);
  });

  it('leaves the main room to the rooms module', () => {
    const db = openDatabase(':memory:');
    const devices = new Devices(db);
    const rooms = new Rooms(db);
    devices.addPaired(IEEE, 'desk');
    rooms.setMainRoom(IEEE, rooms.ensure('gabinet'));
    expect(devices.get(IEEE)).toMatchObject({ room: 'gabinet' });
    expect(rooms.ensure('gabinet')).toBe(devices.get(IEEE)!.roomId);
  });
});
