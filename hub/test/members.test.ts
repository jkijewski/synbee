import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { buildAppServer } from '../src/app-server.js';
import { openDatabase } from '../src/db.js';
import { Members, PAIRING_TTL_MS } from '../src/members.js';
import { homeAddresses } from '../src/network.js';
import { Rooms } from '../src/rooms.js';
import { buildInternalServer } from '../src/server.js';
import { signIn } from './helpers.js';

// App members, pairing and the app API (0020, 0021).
const STEP = [{ kind: 'device', device: '0x0000000000000001', values: { state: 'ON' } }];

function setup() {
  const db = openDatabase(':memory:');
  const clock = { t: Date.UTC(2026, 10, 22, 12) };
  const members = new Members(db, () => clock.t);
  const actions = new Actions(db);
  const rooms = new Rooms(db);
  const appApi = buildAppServer({ members, actions, rooms, version: '0.2.0' });
  return { db, clock, members, actions, rooms, appApi };
}

describe('members', () => {
  it('allows everything by default, including later actions and rooms, and stores revocations', () => {
    const { members, actions, rooms } = setup();
    const kasia = members.create({ name: 'Anna' });
    const garage = rooms.create({ name: 'Garage' });
    const a = actions.create({ name: 'Garage light', steps: STEP });
    expect(members.actionAllowed(kasia.id, a.id)).toBe(true);
    expect(members.roomAllowed(kasia.id, garage.id)).toBe(true);
    members.setPermissions(kasia.id, { revokedRooms: [garage.id], revokedActions: [a.id], devicesWithoutRoom: false });
    expect(members.roomAllowed(kasia.id, garage.id)).toBe(false);
    expect(members.roomAllowed(kasia.id, null)).toBe(false);
    expect(members.actionAllowed(kasia.id, actions.create({ name: 'New', steps: STEP }).id)).toBe(true);
    // Deleting the room deletes its revocation.
    rooms.remove(garage.id, null);
    expect(members.get(kasia.id)!.revokedRooms).toEqual([]);
  });

  it('refuses duplicate names without regard to case, and unknown ids', () => {
    const { members } = setup();
    members.create({ name: 'Jacek' });
    expect(() => members.create({ name: 'jacek' })).toThrow(/already a member called Jacek/);
    expect(() => members.create({ name: ' ' })).toThrow(/1 to 40/);
    expect(() => members.setPermissions(1, { revokedActions: [99] })).toThrow(/Unknown action 99/);
  });

  it('pairs once per code, within 10 minutes, and revokes phones', () => {
    const { members, clock } = setup();
    const jacek = members.create({ name: 'Jacek' });
    const { code } = members.createPairingCode(jacek.id);
    expect(members.get(jacek.id)!.pairingUntil).toBe(clock.t + PAIRING_TTL_MS);
    const paired = members.pair(code.toLowerCase().replace('-', ' '), 'Pixel 8');
    expect(paired.member).toEqual({ id: jacek.id, name: 'Jacek' });
    expect(() => members.pair(code, 'Second')).toThrow(/wrong, used or expired/);
    expect(members.phoneForToken(`Bearer ${paired.token}`)).toMatchObject({ memberName: 'Jacek', phoneName: 'Pixel 8' });
    // The token itself isn't stored.
    expect(JSON.stringify(members.list())).not.toContain(paired.token);
    const late = members.createPairingCode(jacek.id);
    clock.t += PAIRING_TTL_MS + 1;
    expect(() => members.pair(late.code, 'Late')).toThrow(/expired/);
    members.revokePhone(jacek.id, paired.phone.id);
    expect(members.phoneForToken(`Bearer ${paired.token}`)).toBeNull();
  });

  it('replaces an earlier code with a newer one, and removes phones with their member', () => {
    const { members } = setup();
    const m = members.create({ name: 'Ola' });
    const first = members.createPairingCode(m.id);
    const second = members.createPairingCode(m.id);
    expect(() => members.pair(first.code, 'x')).toThrow();
    const { token } = members.pair(second.code, 'Phone');
    members.remove(m.id);
    expect(members.phoneForToken(`Bearer ${token}`)).toBeNull();
  });
});

describe('app API', () => {
  it('pings without a token and answers the test request for a paired phone', async () => {
    const { members, actions, appApi } = setup();
    actions.create({ name: 'Evening', steps: STEP });
    const m = members.create({ name: 'Jacek' });
    expect((await appApi.inject({ method: 'GET', url: '/api/app/v1/ping' })).json()).toEqual({ hub: 'synbee', api: 1, version: '0.2.0' });
    expect((await appApi.inject({ method: 'GET', url: '/api/app/v1/me' })).statusCode).toBe(401);
    const { code } = members.createPairingCode(m.id);
    const pair = await appApi.inject({ method: 'POST', url: '/api/app/v1/pair', payload: { code, phoneName: 'Pixel 8' } });
    expect(pair.statusCode).toBe(200);
    const { token, member } = pair.json();
    expect(member).toBe('Jacek');
    const me = await appApi.inject({ method: 'GET', url: '/api/app/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toEqual({ member: 'Jacek', phone: 'Pixel 8', hubVersion: '0.2.0', actions: 1, rooms: 0, mayPauseAlerts: false, alertsPaused: null });
    expect(me.headers['cache-control']).toBe('no-store');
    expect(members.get(m.id)!.phones[0]!.lastUsedAt).not.toBeNull();
  });

  it('pairs from outside, but serves nothing else there while away from home is off, and nothing but the app API', async () => {
    const { members, appApi } = setup();
    const { code } = members.createPairingCode(members.create({ name: 'Jacek' }).id);
    const outside = await appApi.inject({ method: 'POST', url: '/api/app/v1/pair', payload: { code, phoneName: 'x' }, remoteAddress: '8.8.8.8' });
    expect(outside.statusCode).toBe(200);
    const auth = { authorization: `Bearer ${outside.json().token}` };
    expect((await appApi.inject({ method: 'GET', url: '/api/app/v1/me', headers: auth, remoteAddress: '8.8.8.8' })).statusCode).toBe(403);
    expect((await appApi.inject({ method: 'GET', url: '/api/app/v1/me', headers: auth })).statusCode).toBe(200);
    expect((await appApi.inject({ method: 'GET', url: '/api/devices' })).statusCode).toBe(404);
    expect((await appApi.inject({ method: 'GET', url: '/api/app/v1/%6De' })).statusCode).toBe(401);
  });

  it('limits pairing attempts', async () => {
    const { appApi } = setup();
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await appApi.inject({ method: 'POST', url: '/api/app/v1/pair', payload: { code: 'AAAAA-AAAAA' }, remoteAddress: '192.168.1.9' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('app actions', () => {
  it('lists the actions a phone may run and runs them, hiding drafts and revoked ones', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const sent: unknown[] = [];
    const actions = new Actions(db, { command: async (target: string, values: unknown) => void sent.push({ target, values }) } as never);
    const appApi = buildAppServer({ members, actions, rooms: new Rooms(db), version: 't' });
    const evening = actions.create({ name: 'Evening', icon: 'nightlight', steps: STEP });
    const draft = actions.create({ name: 'Imported', draft: true, steps: STEP });
    const garage = actions.create({ name: 'Garage', steps: STEP });
    const m = members.create({ name: 'Anna' });
    members.setPermissions(m.id, { revokedActions: [garage.id] });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const headers = { authorization: `Bearer ${token}` };
    const list = await appApi.inject({ method: 'GET', url: '/api/app/v1/actions', headers });
    expect(list.json()).toEqual([{ id: evening.id, name: 'Evening', icon: 'nightlight', description: '' }]);
    const run = await appApi.inject({ method: 'POST', url: `/api/app/v1/actions/${evening.id}/run`, headers });
    expect(run.json()).toEqual({ ok: true });
    expect(sent).toEqual([{ target: '0x0000000000000001', values: { state: 'ON' } }]);
    for (const id of [draft.id, garage.id, 999, 'x']) expect((await appApi.inject({ method: 'POST', url: `/api/app/v1/actions/${id}/run`, headers })).statusCode).toBe(404);
    expect((await appApi.inject({ method: 'POST', url: `/api/app/v1/actions/${evening.id}/run` })).statusCode).toBe(401);
    expect(sent).toHaveLength(1);
  });
});

describe('app home', () => {
  it('lists allowed rooms with colours and their actions, hiding actions whose rooms are all revoked', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const actions = new Actions(db);
    const rooms = new Rooms(db);
    const bedroom = rooms.create({ name: 'Bedroom' });
    const garage = rooms.create({ name: 'Garage' });
    rooms.update(garage.id, { color: '#e07f7f' });
    const night = actions.create({ name: 'Night', icon: 'bedtime', steps: STEP });
    const door = actions.create({ name: 'Door', steps: STEP });
    const all = actions.create({ name: 'All off', steps: STEP });
    const loose = actions.create({ name: 'Loose', steps: STEP });
    const membership: Record<number, number[]> = { [night.id]: [bedroom.id], [door.id]: [garage.id], [all.id]: [bedroom.id, garage.id] };
    const appApi = buildAppServer({ members, actions, rooms, actionRooms: () => membership, version: 't' });
    const m = members.create({ name: 'Anna' });
    members.setPermissions(m.id, { revokedRooms: [garage.id] });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const home = (await appApi.inject({ method: 'GET', url: '/api/app/v1/home', headers: { authorization: `Bearer ${token}` } })).json();
    expect(home.rooms).toEqual([{ id: bedroom.id, name: 'Bedroom', icon: expect.any(String), color: expect.stringMatching(/^#[0-9a-f]{6}$/) }]);
    expect(home.actions.map((a: { name: string; rooms: number[] }) => [a.name, a.rooms])).toEqual([
      ['All off', [bedroom.id]],
      ['Loose', []],
      ['Night', [bedroom.id]],
    ]);
    expect(loose.id).toBeGreaterThan(0);
  });

  it('sets who may use one action or room, from that item', () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const actions = new Actions(db);
    const a = actions.create({ name: 'Night', steps: STEP });
    const [jacek, kasia] = [members.create({ name: 'Jacek' }), members.create({ name: 'Anna' })];
    expect(members.access('action', a.id).map((x) => x.allowed)).toEqual([true, true]);
    members.setAccess('action', a.id, [jacek.id]);
    expect(members.actionAllowed(kasia.id, a.id)).toBe(false);
    expect(members.actionAllowed(jacek.id, a.id)).toBe(true);
    expect(members.setAccess('action', a.id, []).map((x) => x.allowed)).toEqual([false, false]);
    expect(() => members.setAccess('room', 99, [])).toThrow(/Unknown room/);
  });
});

describe('members page API', () => {
  it('manages members and makes pairing codes, refusing a phone token', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const app = buildInternalServer({ db, version: 't', members, appListener: { port: 8443, addresses: () => ['192.168.1.20'], fingerprint: () => 'FP=' } });
    const cookie = await signIn(app);
    const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
      app.inject({ method, url, payload: payload as object, headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    const m = (await call('POST', '/api/members', { name: 'Jacek' })).json();
    const pairing = (await call('POST', `/api/members/${m.id}/pairing-code`)).json();
    expect(JSON.parse(pairing.qr)).toEqual({ v: 1, hub: 'synbee', a: ['192.168.1.20:8443'], fp: 'FP=', c: pairing.code });
    const { token, phone } = members.pair(pairing.code, 'Pixel');
    const list = (await call('GET', '/api/members')).json();
    expect(list.members[0].phones).toHaveLength(1);
    expect(list.app).toEqual({ port: 8443, addresses: ['192.168.1.20'], fingerprint: 'FP=' });
    // A phone token is no way into the owner's API.
    expect((await app.inject({ method: 'GET', url: '/api/members', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/members/${m.id}/phones/${phone.id}`)).statusCode).toBe(200);
    expect((await call('PUT', `/api/members/${m.id}`, { name: 'Jacek K' })).json().name).toBe('Jacek K');
    expect((await call('DELETE', `/api/members/${m.id}`)).statusCode).toBe(200);
  });

  it('finds the home addresses of real interfaces', () => {
    const i = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as never;
    expect(homeAddresses({ lo: [i('127.0.0.1', true)], docker0: [i('172.17.0.1')], eth1: [i('10.0.0.5')], eth0: [i('192.168.1.20'), i('8.8.4.4')] })).toEqual(['192.168.1.20', '10.0.0.5']);
  });
});

describe('app listener over TLS', () => {
  it('keeps its key across restarts and serves ping over TLS with it', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const https = await import('node:https');
    const crypto = await import('node:crypto');
    const { ensureTlsIdentity } = await import('../src/tls.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
    const tls = await ensureTlsIdentity(dir);
    expect((await ensureTlsIdentity(dir)).fingerprint).toBe(tls.fingerprint);
    const { members, actions, rooms } = setup();
    const app = buildAppServer({ members, actions, rooms, version: 't', https: { key: tls.key, cert: tls.cert } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    // What the app does: accept exactly the pinned key, whatever the certificate's name or issuer.
    const body = await new Promise<{ body: string; pin: string }>((resolve, reject) => {
      const req = https.get({ host: '127.0.0.1', port, path: '/api/app/v1/ping', rejectUnauthorized: false }, (res) => {
        const cert = (res.socket as import('node:tls').TLSSocket).getPeerX509Certificate()!;
        const pin = crypto.createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ body: data, pin }));
      });
      req.on('error', reject);
    });
    await app.close();
    expect(body.pin).toBe(tls.fingerprint);
    expect(JSON.parse(body.body)).toMatchObject({ hub: 'synbee', api: 1 });
  });
});

describe('app away from home', () => {
  it('refuses outside addresses until allowed, pairs from anywhere, and tells phones where to connect', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    let access = { outside: false, address: '', port: null as number | null };
    const appApi = buildAppServer({ members, actions: new Actions(db), rooms: new Rooms(db), version: 't', access: () => access, homeAddresses: () => ['192.168.1.20:8443'], port: 8443 });
    const m = members.create({ name: 'Jacek' });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const away = (url: string, method: 'GET' | 'POST' = 'GET', payload?: object) =>
      appApi.inject({ method, url, payload, remoteAddress: '89.64.1.2', headers: { authorization: `Bearer ${token}` } });
    expect((await away('/api/app/v1/me')).statusCode).toBe(403);
    access = { outside: true, address: 'myhome.synology.me', port: 18443 };
    // On for the hub, but not yet for this phone.
    expect((await away('/api/app/v1/me')).statusCode).toBe(403);
    const phoneId = members.get(m.id)!.phones[0]!.id;
    expect(members.setPhoneOutside(m.id, phoneId, true).outside).toBe(true);
    expect((await away('/api/app/v1/me')).statusCode).toBe(200);
    // Pairing works away from home, and a phone paired there may be used there.
    const { code } = members.createPairingCode(m.id);
    const awayPair = await appApi.inject({ method: 'POST', url: '/api/app/v1/pair', payload: { code, phoneName: 'Away' }, remoteAddress: '89.64.1.3' });
    expect(awayPair.statusCode).toBe(200);
    expect(members.get(m.id)!.phones.find((p) => p.name === 'Away')!.outside).toBe(true);
    expect((await away('/api/app/v1/connection')).json()).toEqual({ home: ['192.168.1.20:8443'], outside: ['myhome.synology.me:18443'], outsideAllowed: true, hubAllowsOutside: true });
    // A phone not allowed away from home isn't even told the outside address, and works at home as before.
    members.setPhoneOutside(m.id, phoneId, false);
    const home = await appApi.inject({ method: 'GET', url: '/api/app/v1/connection', headers: { authorization: `Bearer ${token}` } });
    expect(home.json()).toMatchObject({ outside: [], outsideAllowed: false });
  });

  it('validates the outside address and port', async () => {
    const { validateAppAccess } = await import('../src/settings.js');
    expect(validateAppAccess({ outside: true, address: 'https://myhome.synology.me/', port: '18443' })).toEqual({ outside: true, address: 'myhome.synology.me', port: 18443 });
    expect(() => validateAppAccess({ outside: true, address: '' })).toThrow(/address/);
    expect(() => validateAppAccess({ address: 'myhome.synology.me', port: 443 })).toThrow(/DSM/);
    expect(() => validateAppAccess({ address: 'my home' })).toThrow(/host name/);
  });

  it('blocks an address after many refused tokens', async () => {
    const db = openDatabase(':memory:');
    const appApi = buildAppServer({ members: new Members(db), actions: new Actions(db), rooms: new Rooms(db), version: 't' });
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await appApi.inject({ method: 'GET', url: '/api/app/v1/me', remoteAddress: '192.168.1.77', headers: { authorization: 'Bearer sb1_x' } })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
