import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { signIn } from './helpers.js';
import { sampleDevices, type SimDevice } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { importTuyaListing } from '../src/tuya-import.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { listing } from './fixtures-tuya.js';

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

const coordinatorOnly = () => sampleDevices.filter((d) => d.type === 'Coordinator');
const remote = (): SimDevice => ({ ...structuredClone(sampleDevices.find((d) => d.friendly_name === 'Wireless Switch')!), friendly_name: '0xa4c1380000000002' });
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const status = (db: Db, ieee: string) =>
  db.prepare('SELECT name, status, source FROM devices WHERE ieee = ?').get(ieee) as { name: string; status: string; source: string } | undefined;

async function setup(timing?: { windowSeconds: number; reopenEveryMs: number }) {
  const db = openDatabase(':memory:');
  importTuyaListing(db, listing);
  sim = await startSimulator({ devices: coordinatorOnly() });
  bridge = new ZigbeeBridge(db, sim.url, 'zigbee2mqtt', timing);
  await bridge.start();
  return db;
}

describe('pairing and joining', () => {
  it('refuses joins while no pairing window is open', async () => {
    await setup();
    expect(await sim!.joinDevice(remote())).toBe(false);
  });

  it('gives an imported device its imported name when it joins', async () => {
    const db = await setup();
    await bridge!.openPairing(60);
    expect(sim!.pairingOpen()).toBe(true);
    expect(await sim!.joinDevice(remote())).toBe(true);
    await until(() => status(db, '0xa4c1380000000002')?.status === 'joined');
    // Zigbee2MQTT gets the plain ASCII form, because the name becomes part of MQTT topics.
    await until(() => sim!.devices.some((d) => d.friendly_name === 'wireless_switch'));
    expect(status(db, '0xa4c1380000000002')).toEqual({ name: 'Wireless Switch', status: 'joined', source: 'tuya-import' });
  });

  it('registers a device that was not imported', async () => {
    const db = await setup();
    await bridge!.openPairing(60);
    const stranger: SimDevice = { ...structuredClone(remote()), ieee_address: '0x00158d0000000099', friendly_name: '0x00158d0000000099' };
    await sim!.joinDevice(stranger);
    await until(() => status(db, '0x00158d0000000099') !== undefined);
    expect(status(db, '0x00158d0000000099')).toEqual({ name: '0x00158d0000000099', status: 'joined', source: 'paired' });
  });

  it('closes pairing when the window ends', async () => {
    await setup();
    await bridge!.openPairing(1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(bridge!.pairingState().open).toBe(false);
    expect(await sim!.joinDevice(remote())).toBe(false);
  });

  it('opens and closes pairing through the internal API, rejecting bad times', async () => {
    const db = await setup();
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
    const headers = { cookie: await signIn(app) };
    expect((await app.inject({ method: 'POST', url: '/api/pairing', payload: { seconds: 999 }, headers })).statusCode).toBe(400);
    const open = await app.inject({ method: 'POST', url: '/api/pairing', payload: { seconds: 30 }, headers });
    expect(open.json()).toMatchObject({ open: true });
    const closed = await app.inject({ method: 'POST', url: '/api/pairing', payload: { seconds: 0 }, headers });
    expect(closed.json()).toMatchObject({ open: false, secondsLeft: 0, until: null });
    expect(sim!.pairingOpen()).toBe(false);
    await app.close();
  });

  it('keeps joining open for a wait of several minutes by re-opening it, and lists joined devices', async () => {
    // Windows of 1 s re-opened every 300 ms stand in for Zigbee2MQTT's 254 s windows re-opened every 240 s.
    await setup({ windowSeconds: 1, reopenEveryMs: 300 });
    const state = await bridge!.openPairingMinutes(10);
    expect(state).toMatchObject({ open: true, joined: [] });
    expect(state.secondsLeft).toBeGreaterThan(590);
    await new Promise((r) => setTimeout(r, 1500));
    // Still open after the first window would have closed by itself.
    expect(sim!.pairingOpen()).toBe(true);
    expect(sim!.permitJoinRequests.length).toBeGreaterThanOrEqual(4);
    expect(sim!.permitJoinRequests.every((t) => t === 1)).toBe(true);
    expect(await sim!.joinDevice(remote())).toBe(true);
    await until(() => bridge!.pairingState().joined[0]?.interview === 'successful');
    expect(bridge!.pairingState().joined).toEqual([
      expect.objectContaining({ ieee: '0xa4c1380000000002', name: 'Wireless Switch', imported: true, supported: true, model: 'SIM-REMOTE-3BTN' }),
    ]);
    await bridge!.closePairing();
    const before = sim!.permitJoinRequests.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(sim!.permitJoinRequests.length).toBe(before);
    expect(sim!.pairingOpen()).toBe(false);
  });

  it('accepts minutes through the internal API and refuses more than 30', async () => {
    const db = await setup();
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
    const headers = { cookie: await signIn(app) };
    expect((await app.inject({ method: 'POST', url: '/api/pairing', payload: { minutes: 31 }, headers })).statusCode).toBe(400);
    const open = await app.inject({ method: 'POST', url: '/api/pairing', payload: { minutes: 10 }, headers });
    expect(open.json()).toMatchObject({ open: true });
    expect(open.json().secondsLeft).toBeGreaterThan(590);
    await bridge!.closePairing();
    await app.close();
  });
});
