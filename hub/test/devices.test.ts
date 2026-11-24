import { afterEach, describe, expect, it } from 'vitest';
import { normalisePress } from '../src/buttons.js';
import { openDatabase } from '../src/db.js';
import { checkValue, flattenExposes } from '../src/exposes.js';
import { buildInternalServer } from '../src/server.js';
import { signIn } from './helpers.js';
import { sampleDevices } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

const SWITCH = '0xa4c1380000000001';
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function setup() {
  const db = openDatabase(':memory:');
  sim = await startSimulator();
  bridge = new ZigbeeBridge(db, sim.url);
  await bridge.start();
  await until(() => bridge!.knownDevices().length === 3);
  const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
  const cookie = await signIn(app);
  const original = app.inject.bind(app);
  const inject = (opts: { method: 'GET' | 'POST'; url: string; payload?: object }) => original({ ...opts, headers: { cookie } });
  return { db, app: { inject, close: () => app.close() } };
}

describe('exposes', () => {
  it('flattens endpoint features and checks values', () => {
    const def = sampleDevices.find((d) => d.ieee_address === SWITCH)!.definition!;
    const props = flattenExposes(def.exposes);
    expect(props.map((p) => p.property)).toEqual(['state_l1', 'state_l2', 'state_l3', 'power_on_behavior']);
    const l1 = props[0]!;
    expect(l1).toMatchObject({ writable: true, endpoint: 'l1', valueOn: 'ON', valueOff: 'OFF' });
    expect(checkValue(l1, 'ON')).toBeNull();
    expect(checkValue(l1, 'MAYBE')).toMatch(/must be one of/);
    expect(checkValue(props[3]!, 'previous')).toBeNull();
  });
});

describe('button normalisation', () => {
  it('maps common action values to press names', () => {
    expect(normalisePress(undefined, '1_single')).toEqual({ button: 1, press: 'single_click' });
    expect(normalisePress(undefined, '2_double')).toEqual({ button: 2, press: 'double_click' });
    expect(normalisePress(undefined, '3_hold')).toEqual({ button: 3, press: 'long_press' });
    expect(normalisePress(undefined, 'single')).toEqual({ button: 1, press: 'single_click' });
    expect(normalisePress(undefined, 'double_click')).toEqual({ button: 1, press: 'double_click' });
    expect(normalisePress(undefined, 'long_press')).toEqual({ button: 1, press: 'long_press' });
    expect(normalisePress(undefined, 'brightness_up')).toBeNull();
    expect(normalisePress(undefined, '')).toBeNull();
  });
});

describe('device state and commands', () => {
  it('switches a channel and reports the new state', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: `/api/devices/${SWITCH}/command`, payload: { state_l1: 'ON' } });
    expect(res.json()).toEqual({ ok: true, state: { state_l1: 'ON' } });
    const toggled = await app.inject({ method: 'POST', url: `/api/devices/${SWITCH}/command`, payload: { state_l1: 'TOGGLE' } });
    expect(toggled.json().state.state_l1).toBe('OFF');
    const detail = await app.inject({ method: 'GET', url: `/api/devices/${SWITCH}` });
    expect(detail.json()).toMatchObject({ name: 'biurko robocze', recognised: true, state: { state_l1: 'OFF' } });
    await app.close();
  });

  it('rejects unknown properties and bad values', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: `/api/devices/${SWITCH}/command`, payload: { colour: 'red' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/devices/${SWITCH}/command`, payload: { state_l1: 'MAYBE' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/devices/0x0000000000000000/command', payload: { state_l1: 'ON' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/devices/0x1234567890abcdef/command', payload: { state: 'ON' } })).statusCode).toBe(409);
    await app.close();
  });

  it('reports a failure when the device does not respond', async () => {
    const { app } = await setup();
    sim!.setOffline('biurko robocze', true);
    const res = await app.inject({ method: 'POST', url: `/api/devices/${SWITCH}/command`, payload: { state_l1: 'ON' } });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ ok: false, error: 'The device did not confirm the change' });
    await app.close();
  }, 20000);

  it('emits normalised button presses with the raw value', async () => {
    await setup();
    const presses: unknown[] = [];
    bridge!.on('button', (p) => presses.push(p));
    await sim!.pressButton('Wireless Switch', '1_single');
    await sim!.pressButton('Wireless Switch', 'scene_7');
    await until(() => presses.length === 2);
    expect(presses).toEqual([
      { ieee: '0xa4c1380000000002', raw: '1_single', button: 1, press: 'single_click' },
      { ieee: '0xa4c1380000000002', raw: 'scene_7' },
    ]);
  });
});

describe('device definitions', () => {
  it('shows unrecognised devices with their raw information', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/devices/0x1234567890abcdef' });
    expect(res.json()).toMatchObject({ recognised: false, supported: false, model: 'TS0601', vendor: '_TZE200_simulated', properties: [] });
    await app.close();
  });

  it('picks up a changed definition without a restart', async () => {
    const { app } = await setup();
    const before = (await app.inject({ method: 'GET', url: `/api/devices/${SWITCH}` })).json();
    expect(before.properties.map((p: { property: string }) => p.property)).not.toContain('child_lock');
    const updated = structuredClone(sim!.devices);
    updated
      .find((d) => d.ieee_address === SWITCH)!
      .definition!.exposes.push({ type: 'binary', name: 'child_lock', property: 'child_lock', access: 3, value_on: 'LOCK', value_off: 'UNLOCK' });
    await sim!.publishDevices(updated);
    await until(() => flattenExposes(bridge!.knownDevices().find((d) => d.ieee_address === SWITCH)!.definition!.exposes).length === 5);
    const after = (await app.inject({ method: 'GET', url: `/api/devices/${SWITCH}` })).json();
    expect(after.properties.find((p: { property: string }) => p.property === 'child_lock')).toMatchObject({ writable: true, valueOn: 'LOCK' });
    expect(after.properties.find((p: { property: string }) => p.property === 'power_on_behavior')).toMatchObject({ type: 'enum', values: ['off', 'on', 'previous'] });
    await app.close();
  });
});
