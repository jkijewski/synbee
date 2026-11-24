import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { buildAppServer } from '../src/app-server.js';
import { openDatabase } from '../src/db.js';
import { DeviceViews } from '../src/device-views.js';
import { Devices } from '../src/devices.js';
import { flattenExposes } from '../src/exposes.js';
import { actionState, stepMatches } from '../src/features/action-state.js';
import { describeDevice } from '../src/features/describe.js';
import { LightGroups } from '../src/groups.js';
import { Members } from '../src/members.js';
import { Rooms } from '../src/rooms.js';
import { sampleBulbs, sampleSensors } from '../src/sim/sample-devices.js';
import { FakeDevices } from './fake-devices.js';

// Device state for the app (0011): "active" actions, the tile's line, details and room pages.
const bulbProps = flattenExposes(sampleBulbs[0]!.definition!.exposes);
const [BULB_A, BULB_B] = ['0x60a423fffe000001', '0x60a423fffe000002'];

describe('whether a device shows what a step sets', () => {
  it('matches on, off, brightness within 5 %, colour within 10° and white temperature', () => {
    const on = { state: 'ON', brightness: 128, color_mode: 'hs', color: { hue: 2, saturation: 100 } };
    expect(stepMatches(bulbProps, { state: 'OFF' }, { state: 'OFF', brightness: 10 }, null)).toBe('match');
    expect(stepMatches(bulbProps, { state: 'OFF' }, on, null)).toBe('differs');
    expect(stepMatches(bulbProps, { state: 'ON', brightness: 135 }, on, null)).toBe('match');
    expect(stepMatches(bulbProps, { brightness: 200 }, on, null)).toBe('differs');
    expect(stepMatches(bulbProps, { color: { hex: '#ff0000' } }, on, 'color')).toBe('match');
    expect(stepMatches(bulbProps, { color: { hex: '#00ff00' } }, on, 'color')).toBe('differs');
    expect(stepMatches(bulbProps, { color: { hex: '#ff0000' } }, on, 'white')).toBe('differs');
    expect(stepMatches(bulbProps, { color_temp: 416 }, { state: 'ON', color_temp: 410 }, 'white')).toBe('match');
    expect(stepMatches(bulbProps, { brightness: 100 }, { state: 'OFF' }, null)).toBe('differs');
    expect(stepMatches(bulbProps, { state: 'TOGGLE' }, on, null)).toBe('unknown');
    expect(stepMatches(bulbProps, { state: 'ON' }, undefined, null)).toBe('unknown');
  });

  it('is active when all match, partly when some do, and unknown when nothing is known', () => {
    expect(actionState(['match', 'match'])).toBe('active');
    expect(actionState(['match', 'differs'])).toBe('partly');
    expect(actionState(['match', 'unknown'])).toBe('partly');
    expect(actionState(['differs'])).toBe('inactive');
    expect(actionState(['unknown'])).toBeNull();
  });

  it('says Closed when a contact sensor reports true, whatever Zigbee2MQTT declares as its "on" value', async () => {
    const { describeValue } = await import('../src/features/describe.js');
    const { wordValue } = await import('../src/features/index.js');
    // As Zigbee2MQTT declares a zbeacon DS01: value_on false (open), value_off true (closed).
    const contact = { property: 'contact', name: 'Contact', type: 'binary', readable: true, writable: false, valueOn: false, valueOff: true };
    expect(describeValue(contact, true)).toBe('Closed');
    expect(describeValue(contact, false)).toBe('Open');
    expect(wordValue(contact, 'on')).toBe(true);
  });

  it('describes a sensor in words, with alarms', () => {
    const leak = sampleSensors.find((s) => s.friendly_name === 'bathroom_leak')!;
    const d = describeDevice(flattenExposes(leak.definition!.exposes), { water_leak: true, battery: 80 }, null);
    expect(d.readings.find((r) => r.property === 'water_leak')).toMatchObject({ attention: 'alarm' });
    expect(d.summary).not.toBe('');
  });
});

describe('app device state', () => {
  async function setup() {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const devices = new Devices(db);
    for (const d of fake.knownDevices()) devices.addPaired(d.ieee_address, d.friendly_name);
    const groups = new LightGroups(db, fake);
    const actions = new Actions(db, fake, groups);
    const rooms = new Rooms(db);
    const members = new Members(db);
    const views = new DeviceViews(db, fake, groups, rooms);
    const bedroom = rooms.create({ name: 'Bedroom' });
    rooms.moveDevices([BULB_A, BULB_B], bedroom.id);
    const g = await groups.create({ name: 'bedroom', members: [{ ieee: BULB_A }, { ieee: BULB_B }] });
    const off = actions.create({ name: 'Off', steps: [{ kind: 'group', group: g.id, values: { state: 'OFF' } }] });
    const appApi = buildAppServer({ members, actions, rooms, actionRooms: () => ({ [off.id]: [bedroom.id] }), views, version: 't' });
    const m = members.create({ name: 'Jacek' });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const get = async (url: string) => (await appApi.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })).json();
    return { fake, actions, views, bedroom, off, g, get };
  }

  it('marks an action active, partly or not, with its line, as the lights change', async () => {
    const { fake, get } = await setup();
    fake.report(BULB_A, { state: 'OFF' });
    fake.report(BULB_B, { state: 'OFF' });
    expect((await get('/api/app/v1/home')).actions[0]).toMatchObject({ name: 'Off', state: 'active', power: 'off', status: 'Off' });
    fake.report(BULB_B, { state: 'ON', brightness: 254 });
    expect((await get('/api/app/v1/home')).actions[0]).toMatchObject({ state: 'partly', status: '1 of 2 on' });
    fake.report(BULB_A, { state: 'ON', brightness: 254 });
    // An "off" action is never coloured, whatever the lights do.
    expect((await get('/api/app/v1/home')).actions[0]).toMatchObject({ state: 'inactive', power: 'off' });
  });

  it('shows one channel of a multi-channel switch, named by its label', async () => {
    const { fake, actions, views } = await setup();
    const SWITCH = '0xa4c1380000000001';
    fake.report(SWITCH, { state_l1: 'OFF', state_l2: 'ON', state_l3: 'OFF' });
    const a = actions.create({ name: 'Desk lamp', steps: [{ kind: 'device', device: SWITCH, values: { state_l1: 'ON' } }] });
    expect(views.actionStatus(a)).toBe('Off');
    expect(views.actionState(a)).toBe('inactive');
    expect(views.actionPower(a)).toBe('off');
    expect(views.device(SWITCH).summary).toMatch(/On/);
  });

  it('colours only the scene that is showing, among scenes on the same lights', async () => {
    const { fake, actions, views, g } = await setup();
    const red = actions.create({ name: 'Red', steps: [{ kind: 'group', group: g.id, values: { color: { hex: '#ff0000' }, brightness: 127 } }] });
    const white = actions.create({ name: 'White', steps: [{ kind: 'group', group: g.id, values: { color_temp: 416, brightness: 254 } }] });
    const on = actions.create({ name: 'On', steps: [{ kind: 'group', group: g.id, values: { state: 'ON' } }] });
    for (const b of [BULB_A, BULB_B]) fake.report(b, { state: 'ON', brightness: 127, color: { hue: 0, saturation: 100 } });
    const look = () => [red, white, on].map((a) => views.tileLook(actions.get(a.id)!));
    expect(look()).toEqual(['on', 'off', 'on']);
    fake.report(BULB_B, { state: 'OFF' });
    // A scene shown by only some lights isn't that scene; a plain "on" is partly on.
    expect(look()).toEqual(['off', 'off', 'partly']);
    // A scene judged by where it ends, not by the colour it passes through on the way.
    const passing = actions.create({ name: 'Passing', steps: [
      { kind: 'group', group: g.id, values: { color: { hue: 6, saturation: 100 }, brightness: 92 } },
      { kind: 'group', group: g.id, values: { state: 'ON' } },
      { kind: 'group', group: g.id, values: { color: { hue: 0, saturation: 100 }, brightness: 254 } },
    ] });
    for (const b of [BULB_A, BULB_B]) fake.report(b, { state: 'ON', brightness: 254, color: { hue: 359, saturation: 100 } });
    expect(views.tileLook(actions.get(passing.id)!)).toBe('on');
    // Showing red, with an old white temperature still in the state: the white scene isn't showing.
    for (const b of [BULB_A, BULB_B]) fake.report(b, { color_mode: 'hs', color_temp: 416 });
    expect(views.tileLook(actions.get(white.id)!)).toBe('off');
  });

  it('shows what the owner chose on the tile', async () => {
    const { fake, actions, off, get } = await setup();
    fake.report(BULB_A, { state: 'ON', brightness: 127 });
    actions.update(off.id, { ...actions.get(off.id)!, tile: { show: 'device', device: BULB_A, property: 'brightness' } });
    expect((await get('/api/app/v1/home')).actions[0].status).toMatch(/50\s*%/);
    actions.update(off.id, { ...actions.get(off.id)!, tile: { show: 'none' } });
    expect((await get('/api/app/v1/home')).actions[0].status).toBe('');
    expect(() => actions.update(off.id, { ...actions.get(off.id)!, tile: { show: 'device', device: 'x' } })).toThrow(/tile shows/);
  });

  it('gives an action its targets and a room its devices', async () => {
    const { fake, off, bedroom, get } = await setup();
    fake.report(BULB_A, { state: 'ON', brightness: 254 });
    const details = await get(`/api/app/v1/actions/${off.id}/details`);
    expect(details.targets[0]).toMatchObject({ kind: 'group', name: 'bedroom' });
    expect(details.targets[0].devices.map((d: { ieee: string }) => d.ieee)).toEqual([BULB_A, BULB_B]);
    const room = await get(`/api/app/v1/rooms/${bedroom.id}`);
    expect(room).toMatchObject({ name: 'Bedroom', color: expect.stringMatching(/^#/) });
    expect(room.devices[0]).toMatchObject({ ieee: BULB_A, room: 'Bedroom', online: true });
    expect(room.devices[0].summary).toMatch(/^On/);
    expect((await get('/api/app/v1/rooms/999')).error).toBe('Not found');
  });
});
