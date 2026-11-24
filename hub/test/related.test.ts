import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';
import { tuyaExport } from './fixtures-tuya-export.js';

const DESK = '0xa4c1380000000001';
const REMOTE = '0xa4c1380000000002';
const BULB = '0x60a423fffe000003';
let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

// The made-up Tuya export: three draft actions toggling desk channels, two on the bedroom light group,
// and three draft rules where remote buttons run those actions.
async function hub() {
  const db = openDatabase(':memory:');
  const app = buildInternalServer({ db, version: 'test' });
  const cookie = await signIn(app);
  const get = async (url: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json();
  await app.inject({ method: 'POST', url: '/api/import/tuya', payload: tuyaExport, headers: { cookie } });
  const actions = (await get('/api/actions')) as Array<{ id: number; name: string }>;
  const rules = (await get('/api/rules')) as Array<{ id: number; name: string }>;
  const id = (list: Array<{ id: number; name: string }>, name: string) => list.find((x) => x.name.includes(name))!.id;
  return { db, app, cookie, get, actions, rules, id };
}

describe('related items', () => {
  it('lists, for a device, the actions and automations that use it, directly and indirectly, with roles', async () => {
    const { get } = await hub();
    const desk = await get(`/api/related/device/${DESK}`);
    expect(desk.actions.map((a: { name: string }) => a.name)).toEqual(['Desk lamp', 'Desk shelf', 'Desk spot']);
    expect(desk.actions[0]).toMatchObject({ draft: true, links: [{ role: 'target' }] });
    // The rules reach the desk switch only through the actions they run.
    const rule = desk.rules.find((r: { name: string }) => r.name.includes('button 1'));
    expect(rule).toMatchObject({ enabled: false, draft: true, links: [{ role: 'target', via: 'action Desk spot' }] });

    const remote = await get(`/api/related/device/${REMOTE}`);
    expect(remote.rules).toHaveLength(3);
    expect(remote.rules[0].links).toEqual([{ role: 'trigger' }]);
    expect(remote.actions).toEqual([]);

    const bulb = await get(`/api/related/device/${BULB}`);
    expect(bulb.groups).toEqual([{ id: expect.any(Number), name: 'salon światła', links: [{ role: 'member' }] }]);
    expect(bulb.actions.map((a: { name: string; links: unknown }) => [a.name, a.links])).toEqual([
      ['salon red', [{ role: 'target', via: 'light group salon światła' }]],
      ['salon światła ON', [{ role: 'target', via: 'light group salon światła' }]],
    ]);
  });

  it('lists, for an action, its devices and automations; for an automation, its devices and actions', async () => {
    const { get, actions, rules, id } = await hub();
    const spot = await get(`/api/related/action/${id(actions, 'Desk spot')}`);
    expect(spot.devices).toEqual([{ ieee: DESK, name: 'biurko robocze', links: [{ role: 'target' }] }]);
    expect(spot.rules.map((r: { name: string; links: unknown }) => [r.name, r.links])).toEqual([['Wireless Switch button 1 single_click → Desk spot', [{ role: 'target' }]]]);
    const red = await get(`/api/related/action/${id(actions, 'salon red')}`);
    expect(red.groups[0]).toMatchObject({ name: 'salon światła', links: [{ role: 'target' }] });
    expect(red.devices).toHaveLength(3);
    expect(red.devices[0].links).toEqual([{ role: 'target', via: 'light group salon światła' }]);

    const b1 = await get(`/api/related/rule/${id(rules, 'button 1')}`);
    expect(b1.devices.map((d: { name: string; links: unknown }) => [d.name, d.links])).toEqual([
      ['biurko robocze', [{ role: 'target', via: 'action Desk spot' }]],
      ['Wireless Switch', [{ role: 'trigger' }]],
    ]);
    expect(b1.actions).toEqual([{ id: id(actions, 'Desk spot'), name: 'Desk spot', draft: true, links: [{ role: 'target' }] }]);
  });

  it('shows conditions and automations started by an action', async () => {
    const { app, cookie, get, actions, id } = await hub();
    const spot = id(actions, 'Desk spot');
    const created = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: { cookie },
      payload: {
        name: 'after spot',
        when: [{ type: 'action', action: spot }],
        if: { mode: 'all', conditions: [{ type: 'state', device: BULB, property: 'state', op: 'eq', value: 'ON' }] },
        then: [{ type: 'wait', seconds: 5 }],
      },
    });
    const ruleId = created.json().id;
    expect((await get(`/api/related/device/${BULB}`)).rules).toEqual([{ id: ruleId, name: 'after spot', enabled: false, draft: false, links: [{ role: 'condition' }] }]);
    const forAction = await get(`/api/related/action/${spot}`);
    expect(forAction.rules.find((r: { id: number }) => r.id === ruleId).links).toEqual([{ role: 'trigger' }]);
  });

  it('warns what uses a device, group or action before deleting it', async () => {
    const { get, actions, id } = await hub();
    const desk = await get(`/api/used-by/device/${DESK}`);
    expect(desk.actions.map((a: { name: string }) => a.name)).toEqual(['Desk lamp', 'Desk shelf', 'Desk spot']);
    // Only direct users: the rules use the desk switch through actions, so deleting the switch leaves them intact.
    expect(desk.rules).toEqual([]);
    expect((await get(`/api/used-by/device/${BULB}`)).groups.map((g: { name: string }) => g.name)).toEqual(['salon światła']);
    expect((await get(`/api/used-by/action/${id(actions, 'Desk spot')}`)).rules).toHaveLength(1);
    expect((await get('/api/related/nothing/1')).error).toBe('Unknown kind');
  });

  it('forgets a pending device, and asks a joined one to leave the network', async () => {
    const db = openDatabase(':memory:');
    sim = await startSimulator();
    bridge = new ZigbeeBridge(db, sim.url);
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.knownDevices().length < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
    const headers = { cookie: await signIn(app) };
    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${DESK}`, headers })).json()).toEqual({ ok: true });
    expect(sim.requests.get('device/remove')).toBe(1);
    expect(sim.devices.some((d) => d.ieee_address === DESK)).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/devices/${DESK}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${DESK}`, headers })).statusCode).toBe(404);
    await app.close();
  });

  it('lists the actions and automations of a room, through its devices', async () => {
    const { get } = await hub();
    const rooms = (await get('/api/rooms')) as Array<{ id: number; name: string }>;
    const komp = await get(`/api/rooms/${rooms.find((r) => r.name === 'gabinet')!.id}/related`);
    expect(komp.actions.map((a: { name: string; devices: string[] }) => [a.name, a.devices])).toEqual([
      ['Desk lamp', ['biurko robocze']],
      ['Desk shelf', ['biurko robocze']],
      ['Desk spot', ['biurko robocze']],
    ]);
    expect(komp.rules).toHaveLength(3);
    expect(komp.rules[0].devices.sort()).toEqual(['Wireless Switch', 'biurko robocze']);
    const syp = await get(`/api/rooms/${rooms.find((r) => r.name === 'salon')!.id}/related`);
    expect(syp.actions.map((a: { name: string }) => a.name)).toEqual(['salon red', 'salon światła ON']);
    expect(syp.groups.map((g: { name: string; devices: string[] }) => [g.name, g.devices.length])).toEqual([['salon światła', 3]]);
    expect(komp.groups).toEqual([]);
    expect(syp.rules).toEqual([]);
    expect((await get('/api/rooms/999/related')).error).toBe('Unknown room');
  });

  it('places actions and automations in the rooms of their devices', async () => {
    const { get, actions, rules, id } = await hub();
    const rooms = (await get('/api/rooms')) as Array<{ id: number; name: string }>;
    const komp = rooms.find((r) => r.name === 'gabinet')!.id;
    const syp = rooms.find((r) => r.name === 'salon')!.id;
    const m = await get('/api/rooms/membership');
    expect(m.actions[id(actions, 'Desk spot')]).toEqual([komp]);
    expect(m.actions[id(actions, 'salon red')]).toEqual([syp]);
    expect(m.rules[id(rules, 'button 1')]).toEqual([komp]);
    expect(Object.values(m.groups)).toEqual([[syp]]);
  });
});
