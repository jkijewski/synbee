import { afterEach, describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';

const SWITCH = '0xa4c1380000000001';
const on = { name: 'Biurko ch1 ON', icon: 'lightbulb', steps: [{ kind: 'device', device: SWITCH, values: { state_l1: 'ON' } }] };

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

describe('action definitions', () => {
  it('creates an action', () => {
    const db = openDatabase(':memory:');
    const actions = new Actions(db);
    const a = actions.create(on);
    expect(a).toMatchObject({ name: 'Biurko ch1 ON', icon: 'lightbulb', steps: [{ kind: 'device', device: SWITCH }] });
    expect(actions.list()).toHaveLength(1);
  });

  it('validates fields and steps', () => {
    const actions = new Actions(openDatabase(':memory:'));
    expect(() => actions.create({ ...on, name: '' })).toThrow(/Name/);
    expect(() => actions.create({ ...on, icon: 'Bad Icon!' })).toThrow(/Icon/);
    expect(() => actions.create({ ...on, steps: [] })).toThrow(/1 to 20 steps/);
    expect(() => actions.create({ ...on, steps: [{ kind: 'device', device: 'nope', values: { a: 1 } }] })).toThrow(/choose a device/);
  });
});

describe('running actions', () => {
  async function setup() {
    const db = openDatabase(':memory:');
    sim = await startSimulator();
    bridge = new ZigbeeBridge(db, sim.url);
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.knownDevices().length < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    return { db, actions: new Actions(db, bridge) };
  }

  it('runs device steps in order', async () => {
    const { actions } = await setup();
    const a = actions.create({ ...on, steps: [...on.steps, { kind: 'device', device: SWITCH, values: { state_l2: 'ON' } }] });
    expect(await actions.run(a.id)).toEqual({ ok: true, steps: [{ step: 1, ok: true }, { step: 2, ok: true }] });
    expect(bridge!.deviceState(SWITCH)).toMatchObject({ state_l1: 'ON', state_l2: 'ON' });
  });

  it('stops at the first failing step and names it', async () => {
    const { actions } = await setup();
    const a = actions.create({ ...on, steps: [{ kind: 'device', device: SWITCH, values: { nope: 1 } }, { kind: 'device', device: SWITCH, values: { state_l2: 'ON' } }] });
    const r = await actions.run(a.id);
    expect(r).toMatchObject({ ok: false, failedStep: 1, steps: [{ step: 1, ok: false }] });
    expect(r.steps).toHaveLength(1);
    expect(bridge!.deviceState(SWITCH)?.state_l2).toBeUndefined();
  });

  it('manages and runs actions through the internal API', async () => {
    const { db, actions } = await setup();
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge, actions });
    const headers = { cookie: await signIn(app) };
    const created = await app.inject({ method: 'POST', url: '/api/actions', payload: on, headers });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect((await app.inject({ method: 'POST', url: `/api/actions/${id}/run`, headers })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/api/actions', headers })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/actions/${id}`, headers })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/api/actions/${id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/actions', headers: {} })).statusCode).toBe(401);
    await app.close();
  });
});
