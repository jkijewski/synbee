import { afterEach, describe, expect, it } from 'vitest';
import { attentionList } from '../src/attention.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { checkValue, flattenExposes } from '../src/exposes.js';
import { confirmationFor, featureFor } from '../src/features/index.js';
import { buildInternalServer } from '../src/server.js';
import { sampleSensors, sampleSensorStates } from '../src/sim/sample-devices.js';
import { sampleDevices } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { FakeDevices } from './fake-devices.js';
import { signIn } from './helpers.js';

// Phase 2 of device support (0008): settings and diagnostics, value steps, sensor words, attention, locks, refresh.
const props = (name: string) => flattenExposes(sampleSensors.find((d) => d.friendly_name === name)!.definition!.exposes);
const prop = (name: string, property: string) => props(name).find((p) => p.property === property)!;

describe('device features, phase 2', () => {
  it("reads Zigbee2MQTT's settings and diagnostics marks, value steps and get access", () => {
    expect(prop('hall_motion', 'sensitivity')).toMatchObject({ category: 'config', writable: true, gettable: true });
    expect(prop('front_door', 'battery')).toMatchObject({ category: 'diagnostic' });
    expect(prop('front_door', 'contact').category).toBeUndefined();
    const setpoint = prop('radiator', 'occupied_heating_setpoint');
    expect(setpoint).toMatchObject({ step: 0.5, min: 5, max: 30 });
    expect(checkValue(setpoint, 21.5)).toBeNull();
    expect(checkValue(setpoint, 21.3)).toMatch(/steps of 0.5/);
    expect(checkValue(prop('radiator', 'local_temperature_calibration'), -1.3)).toBeNull();
  });

  it('words yes/no sensors by meaning and flags alarms and warnings', () => {
    const contact = featureFor(prop('front_door', 'contact'));
    expect(contact.words).toEqual({ on: 'Closed', off: 'Open' });
    expect(contact.attention).toBeUndefined();
    const leak = prop('bathroom_leak', 'water_leak');
    expect(featureFor(leak).attention!(true, leak)).toBe('alarm');
    expect(featureFor(leak).attention!(false, leak)).toBeNull();
    expect(featureFor(prop('hall_motion', 'occupancy')).words).toEqual({ on: 'Motion', off: 'Clear' });
    expect(featureFor(prop('hall_motion', 'illuminance_lux')).id).toBe('illuminance');
    const battery = prop('hall_motion', 'battery');
    expect(featureFor(battery).attention!(11, battery)).toBe('warning');
    expect(featureFor(battery).attention!(60, battery)).toBeNull();
  });

  it('labels locks Locked / Unlocked and asks before unlocking, but not before locking', () => {
    const state = prop('front_lock', 'state');
    expect(featureFor(state).id).toBe('lock');
    expect(featureFor(state).words).toEqual({ on: 'Locked', off: 'Unlocked' });
    expect(confirmationFor(props('front_lock'), { state: 'UNLOCK' })).toMatch(/unlocks the door/);
    expect(confirmationFor(props('front_lock'), { state: 'LOCK' })).toBeNull();
    // A child lock on a radiator is a setting, not a door: no question.
    expect(featureFor(prop('radiator', 'child_lock')).id).toBe('child_lock');
    expect(confirmationFor(props('radiator'), { child_lock: 'UNLOCK' })).toBeNull();
  });

  it('lists what needs attention: alarms first, then warnings and offline devices', () => {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const devices = new Devices(db);
    for (const d of sampleSensors) {
      devices.addPaired(d.ieee_address, d.friendly_name);
      fake.report(d.ieee_address, sampleSensorStates[d.friendly_name]!);
    }
    fake.offline.add('0x00158d0000000105');
    expect(attentionList(devices, fake)).toEqual([
      { ieee: '0x00158d0000000102', name: 'bathroom_leak', level: 'alarm', what: 'Water leak: Wet' },
      { ieee: '0x00158d0000000103', name: 'hall_motion', level: 'warning', what: 'Battery: 11 %' },
      { ieee: '0x00158d0000000105', name: 'radiator', level: 'warning', what: 'Offline' },
    ]);
  });
});

describe('device API, phase 2', () => {
  let sim: Simulator | undefined;
  let bridge: ZigbeeBridge | undefined;
  afterEach(async () => {
    await bridge?.stop();
    await sim?.close();
    sim = bridge = undefined;
  });

  it('refuses an unlock without confirmation, refreshes values on request, and reports attention', async () => {
    const db = openDatabase(':memory:');
    sim = await startSimulator({ devices: [...structuredClone(sampleDevices), ...structuredClone(sampleSensors)] });
    bridge = new ZigbeeBridge(db, sim.url);
    await bridge.start();
    const until = async (check: () => boolean) => {
      const end = Date.now() + 3000;
      while (!check()) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await until(() => bridge!.knownDevices().length === sampleDevices.length - 1 + sampleSensors.length);
    for (const [name, values] of Object.entries(sampleSensorStates)) await sim.report(name, values);
    await until(() => bridge!.deviceState('0x00158d0000000102')?.water_leak === true);
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
    const headers = { cookie: await signIn(app) };
    const LOCK = '0x00158d0000000104';
    const refused = await app.inject({ method: 'POST', url: `/api/devices/${LOCK}/command`, headers, payload: { state: 'UNLOCK' } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().confirm).toMatch(/unlocks the door/);
    const unlocked = await app.inject({ method: 'POST', url: `/api/devices/${LOCK}/command?confirmed=1`, headers, payload: { state: 'UNLOCK' } });
    expect(unlocked.json()).toMatchObject({ ok: true, state: { state: 'UNLOCK' } });
    expect((await app.inject({ method: 'POST', url: `/api/devices/${LOCK}/command`, headers, payload: { state: 'LOCK' } })).json()).toMatchObject({ ok: true });
    const refreshed = await app.inject({ method: 'POST', url: '/api/devices/0x00158d0000000103/refresh', headers });
    expect(refreshed.json()).toMatchObject({ ok: true, state: { sensitivity: 'medium' } });
    expect((await app.inject({ method: 'POST', url: '/api/devices/0x00158d0000000101/refresh', headers })).statusCode).toBe(400);
    const attention = (await app.inject({ method: 'GET', url: '/api/attention', headers })).json() as Array<{ name: string; what: string }>;
    expect(attention.map((a) => `${a.name}: ${a.what}`)).toEqual(['bathroom_leak: Water leak: Wet', 'hall_motion: Battery: 11 %']);
    await app.close();
  });
});
