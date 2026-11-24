import mqtt from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { buttonEvents, normalisePress } from '../src/buttons.js';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { sampleDevices, type SimDevice } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { z2mFriendlyName } from '../src/device-kinds.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

const SWITCH = '0xa4c1380000000001';
const bulb = (ieee: string, name: string): SimDevice => ({
  ieee_address: ieee,
  friendly_name: name,
  type: 'Router',
  supported: true,
  interview_completed: true,
  definition: {
    model: 'SIM-BULB',
    vendor: 'Simulated',
    description: 'Simulated RGB+CCT bulb',
    exposes: [
      {
        type: 'light',
        features: [
          { type: 'binary', name: 'state', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF', value_toggle: 'TOGGLE' },
          { type: 'numeric', name: 'brightness', property: 'brightness', access: 7, value_min: 0, value_max: 254 },
        ],
      },
    ],
    options: [],
  },
});
const BULBS = [bulb('0x60a423fffe000003', 'salon_regal'), bulb('0x60a423fffe000002', 'salon_polka')];
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function setup() {
  const db = openDatabase(':memory:');
  sim = await startSimulator({ devices: [...structuredClone(sampleDevices), ...structuredClone(BULBS)] });
  bridge = new ZigbeeBridge(db, sim.url);
  await bridge.start();
  await until(() => bridge!.knownDevices().length === 5 && bridge!.bridgeInfo() !== null);
  const app = buildInternalServer({ db, version: 'test', zigbee: bridge, z2mVersion: '2.14.3' });
  const cookie = await signIn(app);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { db, app, call };
}

describe('friendly names', () => {
  it('turns display names into plain ASCII topic names', () => {
    expect(z2mFriendlyName('biurko robocze ')).toBe('biurko_robocze');
    expect(z2mFriendlyName('salon półka')).toBe('salon_polka');
    expect(z2mFriendlyName('Salon ŚWIATŁA / góra')).toBe('salon_swiatla_gora');
    expect(z2mFriendlyName('???')).toBe('device');
  });
});

describe('buttons', () => {
  it('maps every value of the Tuya 3-button remote', () => {
    for (const b of [1, 2, 3]) {
      expect(normalisePress('TS0043', `${b}_single`)).toEqual({ button: b, press: 'single_click' });
      expect(normalisePress('TS0043', `${b}_double`)).toEqual({ button: b, press: 'double_click' });
      expect(normalisePress('TS0043', `${b}_hold`)).toEqual({ button: b, press: 'long_press' });
    }
    expect(normalisePress('TS0043', '4_single')).toEqual({ button: 4, press: 'single_click' });
  });

  it('lists a remote\'s events for rule choices, keeping raw values without a mapping', () => {
    const exposes = [{ type: 'enum', property: 'action', access: 1, values: ['1_single', '1_hold', 'brightness_step_up'] }];
    expect(buttonEvents('TS0043', exposes)).toEqual([
      { raw: '1_single', button: 1, press: 'single_click' },
      { raw: '1_hold', button: 1, press: 'long_press' },
      { raw: 'brightness_step_up' },
    ]);
    expect(buttonEvents('X', [])).toEqual([]);
  });
});

describe('status, availability and labels', () => {
  it('shows Zigbee2MQTT and coordinator details without the configuration', async () => {
    const { call } = await setup();
    const status = (await call('GET', '/api/status')).json();
    expect(status.zigbee2mqtt).toMatchObject({
      bundled: '2.14.3',
      connected: true,
      info: { version: '2.14.3-sim', coordinator: { ieee: '0x00124b0000000001', type: 'EmberZNet', firmware: '8.0.2' }, network: { channel: 25 } },
    });
    expect(JSON.stringify(status)).not.toMatch(/mqtt:\/\/|network_key|config/);
  });

  it('asks Zigbee2MQTT to read a device again', async () => {
    const { call } = await setup();
    expect((await call('POST', `/api/devices/${SWITCH}/interview`)).json()).toEqual({ ok: true });
    expect(sim!.requests.get('device/interview')).toBe(1);
    expect((await call('POST', '/api/devices/0x0000000000000009/interview')).statusCode).toBe(502);
  });

  it('reports devices going offline', async () => {
    const { call } = await setup();
    await until(() => bridge!.isOnline(SWITCH) === true);
    sim!.setOffline('biurko robocze', true);
    await until(() => bridge!.isOnline(SWITCH) === false);
    expect((await call('GET', `/api/devices/${SWITCH}`)).json()).toMatchObject({ online: false });
  });

  it('keeps a renamed device online: ignores the old name being cleared, applies the new name once known', async () => {
    await setup();
    await until(() => bridge!.isOnline(SWITCH) === true);
    // What Zigbee2MQTT does on a rename (seen on a real network): the new name's "online" may come before the device list
    // has the new name, and the old name's retained availability is cleared with an empty message.
    const client = await mqtt.connectAsync(sim!.url);
    await client.publishAsync('zigbee2mqtt/biurko_new/availability', JSON.stringify({ state: 'online' }), { retain: true });
    await client.publishAsync('zigbee2mqtt/biurko robocze/availability', '', { retain: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(bridge!.isOnline(SWITCH)).toBe(true);
    await sim!.publishDevices(sim!.devices.map((d) => (d.ieee_address === SWITCH ? { ...d, friendly_name: 'biurko_new' } : d)));
    await until(() => bridge!.knownDevices().some((d) => d.friendly_name === 'biurko_new'));
    expect(bridge!.isOnline(SWITCH)).toBe(true);
    await client.endAsync();
  });

  it('hears a renamed remote at once, even when the new device list is late', async () => {
    await setup();
    const REMOTE = '0xa4c1380000000002';
    sim!.quietRenames = true;
    await bridge!.rename(REMOTE, 'Wyłącznik 3-pozycyjny salon');
    const presses: Array<{ ieee: string; raw: unknown }> = [];
    bridge!.on('button', (e: { ieee: string; raw: unknown }) => presses.push(e));
    await sim!.pressButton('wylacznik_3_pozycyjny_salon', '1_single');
    await until(() => presses.length === 1);
    expect(presses[0]).toMatchObject({ ieee: REMOTE, raw: '1_single', button: 1, press: 'single_click' });
  });

  it('saves, shows and removes channel labels', async () => {
    const { db, call } = await setup();
    expect((await call('PUT', `/api/devices/${SWITCH}/labels`, { l1: 'spot', l2: 'LED', l3: 'regał' })).json()).toEqual({ l1: 'spot', l2: 'LED', l3: 'regał' });
    expect((await call('PUT', `/api/devices/${SWITCH}/labels`, { l2: '' })).json()).toEqual({ l1: 'spot', l3: 'regał' });
    expect((await call('PUT', `/api/devices/${SWITCH}/labels`, { 'l1/x': 'bad' })).statusCode).toBe(400);
    expect((await call('PUT', '/api/devices/0x0000000000000000/labels', { l1: 'a' })).statusCode).toBe(404);
    const detail = (await call('GET', `/api/devices/${SWITCH}`)).json();
    expect(detail.labels).toEqual({ l1: 'spot', l3: 'regał' });
  });
});

describe('light groups', () => {
  it('creates a planned group once its bulbs have joined, and switches all of them at once', async () => {
    const { db, call } = await setup();
    // As if imported and not yet moved.
    db.prepare("UPDATE devices SET status = 'pending'").run();
    const { LightGroups } = await import('../src/groups.js');
    const id = new LightGroups(db, bridge).plan('salon światła', 'imported from Tuya');
    // Not runnable yet.
    expect((await call('POST', `/api/groups/${id}/command`, { state: 'ON' })).statusCode).toBe(409);
    const members = BULBS.map((b) => ({ ieee: b.ieee_address }));
    expect((await call('POST', `/api/groups/${id}/create`, { members })).statusCode).toBe(409);
    db.prepare("UPDATE devices SET status = 'joined'").run();
    const created = await call('POST', `/api/groups/${id}/create`, { members });
    expect(created.statusCode).toBe(200);
    await until(() => sim!.groups[0]?.members.length === 2);
    expect(sim!.groups[0]!.friendly_name).toBe('salon_swiatla');
    await until(() => bridge!.groups()[0]?.members.length === 2);
    const list = (await call('GET', '/api/groups')).json();
    expect(list[0]).toMatchObject({ name: 'salon światła', created: true, z2mName: 'salon_swiatla' });
    expect(list[0].properties.map((p: { property: string }) => p.property)).toEqual(['state', 'brightness']);
    expect((await call('POST', `/api/groups/${id}/command`, { state: 'ON', brightness: 300 })).statusCode).toBe(400);
    expect((await call('POST', `/api/groups/${id}/command`, { state: 'TOGGLE' })).statusCode).toBe(200);
    await until(() => BULBS.every((b) => bridge!.deviceState(b.ieee_address)?.state === 'ON'));
  });

  it('runs an action with a group step, and reports a draft action\'s missing devices', async () => {
    const { db, call } = await setup();
    const group = (await call('POST', '/api/groups', { name: 'salon światła', members: BULBS.map((b) => b.ieee_address) })).json();
    await until(() => bridge!.groups()[0]?.members.length === 2);
    db.prepare("INSERT INTO devices (ieee, name, status, source) VALUES ('0x60a423fffe000001', 'salon góra', 'pending', 'tuya-import')").run();
    const action = (
      await call('POST', '/api/actions', {
        name: 'salon światła ON',
        draft: true,
        steps: [
          { kind: 'group', group: group.id, values: { state: 'ON' } },
          { kind: 'device', device: '0x60a423fffe000001', values: { state: 'ON' } },
        ],
      })
    ).json();
    expect(action).toMatchObject({ draft: true });
    const listed = (await call('GET', '/api/actions')).json()[0];
    expect(listed.readiness).toEqual({ ready: false, missing: ['salon góra (not moved yet)'] });
    const run = (await call('POST', `/api/actions/${action.id}/run`)).json();
    expect(run).toMatchObject({ ok: false, failedStep: 2 });
    await until(() => BULBS.every((b) => bridge!.deviceState(b.ieee_address)?.state === 'ON'));
  });
});
