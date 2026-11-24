import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { sampleDevices, type SimDevice } from '../src/sim/sample-devices.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';
import { tuyaExport } from './fixtures-tuya-export.js';

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

const DESK = '0xa4c1380000000001';
const REMOTE = '0xa4c1380000000002';

async function hub() {
  const db = openDatabase(':memory:');
  const app = buildInternalServer({ db, version: 'test' });
  const cookie = await signIn(app);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await call('POST', '/api/import/tuya', tuyaExport);
  const rooms = async () => (await call('GET', '/api/rooms')).json() as Array<{ id: number; name: string; icon: string; devices: string[]; alsoDevices: string[] }>;
  return { db, app, call, rooms };
}

describe('rooms', () => {
  it('reuses the imported rooms, in the Tuya order, with one main room per device', async () => {
    const { rooms } = await hub();
    const list = await rooms();
    expect(list.map((r) => [r.name, r.icon])).toEqual([
      ['gabinet', 'meeting_room'],
      ['salon', 'meeting_room'],
    ]);
    expect(list[0]!.devices.sort()).toEqual([DESK, REMOTE].sort());
    expect(list[1]!.devices).toHaveLength(3);
  });

  it('creates, renames, gives an icon to, reorders and refuses duplicate rooms', async () => {
    const { call, rooms } = await hub();
    const kitchen = (await call('POST', '/api/rooms', { name: 'kuchnia', icon: 'kitchen' })).json();
    expect(kitchen).toMatchObject({ name: 'kuchnia', icon: 'kitchen', devices: [] });
    expect((await call('POST', '/api/rooms', { name: 'kuchnia' })).statusCode).toBe(409);
    expect((await call('POST', '/api/rooms', { name: '' })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/rooms/${kitchen.id}`, { icon: '<b>' })).statusCode).toBe(400);
    await call('PATCH', `/api/rooms/${kitchen.id}`, { name: 'kuchnia letnia' });
    const ids = (await rooms()).map((r) => r.id);
    await call('PUT', '/api/rooms/order', { order: [kitchen.id, ...ids.filter((x) => x !== kitchen.id)] });
    expect((await rooms()).map((r) => r.name)).toEqual(['kuchnia letnia', 'gabinet', 'salon']);
  });

  it('shows a device in more rooms, keeping one main room', async () => {
    const { call, rooms } = await hub();
    const [komp, syp] = await rooms();
    expect((await call('PUT', `/api/devices/${REMOTE}/rooms`, { also: [syp!.id, komp!.id] })).json()).toEqual({ room: komp!.id, also: [syp!.id] });
    const after = await rooms();
    expect(after[0]!.devices).toContain(REMOTE);
    expect(after[1]!.alsoDevices).toEqual([REMOTE]);
    const device = (await call('GET', `/api/devices/${REMOTE}`)).json();
    expect(device).toMatchObject({ room: 'gabinet', roomId: komp!.id, alsoRooms: [syp!.id] });
    // Making an extra room the main room removes it from the extras.
    await call('PATCH', `/api/devices/${REMOTE}`, { room: 'salon' });
    expect((await call('GET', `/api/devices/${REMOTE}`)).json()).toMatchObject({ room: 'salon', alsoRooms: [] });
    expect((await call('PUT', `/api/devices/${REMOTE}/rooms`, { room: 9999 })).statusCode).toBe(400);
  });

  it('moves a deleted room\'s devices to another room, or leaves them without one', async () => {
    const { call, rooms } = await hub();
    const [komp, syp] = await rooms();
    await call('PUT', `/api/devices/${DESK}/rooms`, { also: [syp!.id] });
    expect((await call('DELETE', `/api/rooms/${komp!.id}`, { moveTo: komp!.id })).statusCode).toBe(400);
    expect((await call('DELETE', `/api/rooms/${komp!.id}`, { moveTo: syp!.id })).statusCode).toBe(200);
    const [only] = await rooms();
    expect(only!.devices).toHaveLength(5);
    expect(only!.alsoDevices).toEqual([]);
    await call('DELETE', `/api/rooms/${syp!.id}`, {});
    expect((await call('GET', '/api/devices')).json().every((d: { room: string | null }) => d.room === null)).toBe(true);
  });

  it('makes a light group from the lights of a room', async () => {
    const bulb = (ieee: string, name: string): SimDevice => ({
      ieee_address: ieee,
      friendly_name: name,
      type: 'Router',
      supported: true,
      interview_completed: true,
      definition: {
        model: 'SIM-BULB',
        vendor: 'Simulated',
        description: 'bulb',
        exposes: [{ type: 'light', features: [{ type: 'binary', name: 'state', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF' }] }],
        options: [],
      },
    });
    const db = openDatabase(':memory:');
    sim = await startSimulator({ devices: [...structuredClone(sampleDevices), bulb('0x60a423fffe000003', 'a'), bulb('0x60a423fffe000002', 'b')] });
    bridge = new ZigbeeBridge(db, sim.url);
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.knownDevices().length < 5 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge });
    const headers = { cookie: await signIn(app) };
    const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { name: 'salon' } })).json();
    for (const ieee of ['0x60a423fffe000003', '0x60a423fffe000002', DESK]) {
      await app.inject({ method: 'PUT', url: `/api/devices/${ieee}/rooms`, headers, payload: { room: room.id } });
    }
    const group = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/light-group`, headers });
    expect(group.statusCode).toBe(200);
    expect(group.json().members.map((m: { ieee: string }) => m.ieee).sort()).toEqual(['0x60a423fffe000002', '0x60a423fffe000003']);
    await app.close();
  });

  it('moves several devices at once, and removes a device from its main room or an extra room', async () => {
    const { call, rooms } = await hub();
    const [komp, syp] = await rooms();
    const bulbs = syp!.devices;
    expect((await call('POST', '/api/rooms/move', { devices: bulbs, room: komp!.id })).json()).toEqual({ moved: 3 });
    expect((await rooms())[0]!.devices).toHaveLength(5);
    expect((await call('POST', '/api/rooms/move', { devices: [], room: komp!.id })).statusCode).toBe(400);
    expect((await call('POST', '/api/rooms/move', { devices: bulbs, room: 999 })).statusCode).toBe(400);
    // Removing from the main room leaves the device not assigned.
    await call('DELETE', `/api/rooms/${komp!.id}/devices/${DESK}`);
    expect((await call('GET', `/api/devices/${DESK}`)).json()).toMatchObject({ room: null, roomId: null });
    // Removing from an extra room keeps the main room.
    await call('PUT', `/api/devices/${REMOTE}/rooms`, { also: [syp!.id] });
    await call('DELETE', `/api/rooms/${syp!.id}/devices/${REMOTE}`);
    expect((await call('GET', `/api/devices/${REMOTE}`)).json()).toMatchObject({ room: 'gabinet', alsoRooms: [] });
    expect((await call('DELETE', `/api/rooms/${syp!.id}/devices/${REMOTE}`)).statusCode).toBe(404);
    // Moving to none.
    await call('POST', '/api/rooms/move', { devices: [REMOTE], room: null });
    expect((await call('GET', `/api/devices/${REMOTE}`)).json().room).toBeNull();
  });

  it('adds devices to a room, keeping their main room, or making it the main room when they have none', async () => {
    const { call, rooms } = await hub();
    const [komp, syp] = await rooms();
    await call('POST', '/api/rooms/move', { devices: [DESK], room: null });
    expect((await call('POST', '/api/rooms/add', { devices: [DESK, REMOTE, ...syp!.devices], room: syp!.id })).json()).toEqual({ main: 1, extra: 1 });
    expect((await call('GET', `/api/devices/${DESK}`)).json()).toMatchObject({ room: 'salon', alsoRooms: [] });
    expect((await call('GET', `/api/devices/${REMOTE}`)).json()).toMatchObject({ room: 'gabinet', alsoRooms: [syp!.id] });
    expect((await call('POST', '/api/rooms/add', { devices: [REMOTE], room: 999 })).statusCode).toBe(400);
    expect(komp).toBeDefined();
  });

  it('keeps a chosen colour or none, and refuses bad ones', async () => {
    const { call, rooms } = await hub();
    const [komp] = await rooms();
    expect(komp).toMatchObject({ color: null, photo: null });
    expect((await call('PATCH', `/api/rooms/${komp!.id}`, { color: '#A0C4FF' })).json()).toMatchObject({ color: '#a0c4ff' });
    expect((await call('PATCH', `/api/rooms/${komp!.id}`, { color: 'red' })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/rooms/${komp!.id}`, { color: null })).json()).toMatchObject({ color: null });
  });

  it('stores a room photo as a thumbnail and a phone-sized picture, for signed-in users only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-photos-'));
    const db = openDatabase(':memory:');
    const app = buildInternalServer({ db, version: 'test', photoDir: dir });
    const headers = { cookie: await signIn(app) };
    const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { name: 'salon' } })).json();
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    const url = `/api/rooms/${room.id}/photo`;
    expect((await app.inject({ method: 'PUT', url, headers, payload: { thumb: Buffer.from('<svg/>').toString('base64'), mobile: jpeg.toString('base64') } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url, headers, payload: { thumb: webp.toString('base64') } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url, headers, payload: { thumb: Buffer.alloc(300 * 1024, 0xff).toString('base64'), mobile: jpeg.toString('base64') } })).statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url, headers, payload: { thumb: webp.toString('base64'), mobile: jpeg.toString('base64') } });
    expect(saved.json().photo).toEqual(expect.any(Number));
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const thumb = await app.inject({ method: 'GET', url, headers });
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ method: 'GET', url: `${url}?size=mobile`, headers })).headers['content-type']).toBe('image/jpeg');
    expect((await app.inject({ method: 'GET', url: '/api/rooms', headers })).json()[0].photo).toBe(saved.json().photo);
    await app.inject({ method: 'DELETE', url, headers });
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(404);
    expect(fs.readdirSync(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
    await app.close();
  });
});
