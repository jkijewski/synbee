import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { DeviceViews } from '../src/device-views.js';
import { Devices } from '../src/devices.js';
import { LightGroups } from '../src/groups.js';
import { Members } from '../src/members.js';
import { Rooms } from '../src/rooms.js';
import { statusTiles } from '../src/status-tiles.js';
import { DeviceTiles } from '../src/tiles.js';
import { inUnit, setTemperatureUnit, temperatureColor, toFahrenheit } from '../src/units.js';
import { FakeDevices } from './fake-devices.js';

// Number tiles, the owner's words on yes/no tiles, the temperature unit, and who sees which tile.
const DOOR = '0x00158d0000000101';
const CLIMATE = '0x00158d0000000107';

function setup() {
  const db = openDatabase(':memory:');
  const fake = new FakeDevices();
  const devices = new Devices(db);
  for (const d of fake.knownDevices()) devices.addPaired(d.ieee_address, d.friendly_name);
  const rooms = new Rooms(db);
  const views = new DeviceViews(db, fake, new LightGroups(db, fake), rooms);
  const deviceTiles = new DeviceTiles(db);
  return { db, fake, views, deviceTiles, tiles: () => statusTiles({ db, views, deviceTiles }) };
}

describe('units', () => {
  it('converts Celsius in texts and colours temperatures', () => {
    expect(toFahrenheit(21.4)).toBe(70.5);
    expect(inUnit('21.4 °C · 48 %', 'F')).toBe('70.5 °F · 48 %');
    expect(inUnit('21.4 °C', 'C')).toBe('21.4 °C');
    expect(temperatureColor(5)).toBe('#3b82f6');
    expect(temperatureColor(21)).toBe('#4aba6a');
    expect(temperatureColor(35)).toBe('#e5534b');
  });
});

describe('device tiles', () => {
  it('shows a number with its unit and colour, and a yes/no reading in the owner words', () => {
    const { db, fake, deviceTiles, tiles } = setup();
    fake.report(CLIMATE, { temperature: 18.5, humidity: 48 });
    fake.report(DOOR, { contact: false });
    deviceTiles.set(CLIMATE, true, 'temperature');
    deviceTiles.set(DOOR, true, 'contact', { active: 'Otwarte', inactive: 'Zamknięte' });
    let [climate, door] = tiles();
    expect(climate).toMatchObject({ text: '18.5 °C', color: temperatureColor(18.5) });
    expect(door).toMatchObject({ text: 'Otwarte', level: 'warning' });
    setTemperatureUnit(db, 'F');
    fake.report(DOOR, { contact: true });
    [climate, door] = tiles();
    expect(climate!.text).toBe('65.3 °F');
    expect(door).toMatchObject({ text: 'Zamknięte', level: 'fine' });
  });

  it('lets the owner hide a tile from some members', () => {
    const { db } = setup();
    const members = new Members(db);
    const anna = members.create({ name: 'Anna' });
    const tom = members.create({ name: 'Tom' });
    expect(members.tileAllowed(anna.id, 'sensors:1')).toBe(true);
    members.setTileAccess('sensors:1', [anna.id]);
    expect(members.tileAllowed(anna.id, 'sensors:1')).toBe(true);
    expect(members.tileAllowed(tom.id, 'sensors:1')).toBe(false);
    expect(members.tileAccess('sensors:1').map((m) => [m.name, m.allowed])).toEqual([['Anna', true], ['Tom', false]]);
    expect(() => members.setTileAccess('nonsense', [])).toThrow(/Unknown tile/);
  });
});
