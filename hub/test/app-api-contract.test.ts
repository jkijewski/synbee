import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { APP_API_PREFIX, APP_ROUTES, appApiOpenApi } from '../src/app-api-schema.js';
import { buildAppServer } from '../src/app-server.js';
import { openDatabase } from '../src/db.js';
import { Members } from '../src/members.js';
import { Rooms } from '../src/rooms.js';
import { AlertPause } from '../src/alert-pause.js';

// The app API's contract (0021): the committed OpenAPI document is the one the schemas generate, and every route the
// listener serves is in it.
describe('app API contract', () => {
  it('matches the committed OpenAPI document (run `npm run openapi` after changing app-api-schema.ts)', () => {
    const committed = JSON.parse(readFileSync(new URL('../../openapi/app-api.json', import.meta.url), 'utf8')) as unknown;
    expect(committed).toEqual(JSON.parse(JSON.stringify(appApiOpenApi())));
  });

  it('serves exactly the documented routes', async () => {
    const db = openDatabase(':memory:');
    const app = buildAppServer({ members: new Members(db), actions: new Actions(db), rooms: new Rooms(db), version: 't' });
    await app.ready();
    for (const r of APP_ROUTES) expect(app.hasRoute({ method: r.method, url: APP_API_PREFIX + r.path })).toBe(true);
    // Anything else is refused when it is added (the listener's onRoute check), so it can't be served undocumented.
  });

  it('answers in the documented shape, errors included', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const app = buildAppServer({ members, actions: new Actions(db), rooms: new Rooms(db), version: '0.2.0' });
    expect((await app.inject({ method: 'GET', url: `${APP_API_PREFIX}/ping` })).json()).toEqual({ hub: 'synbee', api: 1, version: '0.2.0' });
    expect((await app.inject({ method: 'POST', url: `${APP_API_PREFIX}/pair`, payload: {} })).json()).toEqual({ error: expect.stringMatching(/Invalid request/) });
    const { code } = members.createPairingCode(members.create({ name: 'Jacek' }).id);
    const pair = (await app.inject({ method: 'POST', url: `${APP_API_PREFIX}/pair`, payload: { code, phoneName: 'Pixel' } })).json();
    expect(Object.keys(pair).sort()).toEqual(['member', 'phone', 'token']);
    const auth = { authorization: `Bearer ${pair.token}` };
    expect((await app.inject({ method: 'GET', url: `${APP_API_PREFIX}/home`, headers: auth })).json()).toEqual({ rooms: [], actions: [], tiles: [] });
    expect((await app.inject({ method: 'POST', url: `${APP_API_PREFIX}/actions/7/run`, headers: auth })).json()).toEqual({ error: 'Not found' });
  });
});

describe('status tiles in the app API', () => {
  it('shows tiles of rooms the member may see, and leaves devices of other rooms out of explanations', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const rooms = new Rooms(db);
    const hall = rooms.create({ name: 'Hall', icon: 'door_front' });
    const garage = rooms.create({ name: 'Garage', icon: 'garage' });
    const tiles = () => [
      { id: 'sensors:1', kind: 'sensors' as const, room: hall.id, name: 'Windows', icon: 'sensor_door', text: '2 of 3 open', level: 'warning' as const, why: [{ text: 'Hall window', room: hall.id }, { text: 'Garage window', room: garage.id }] },
      { id: 'check:1', kind: 'check' as const, room: garage.id, name: 'Garage closed', icon: 'report', text: 'Open', level: 'warning' as const, why: [] },
    ];
    const app = buildAppServer({ members, actions: new Actions(db), rooms, version: 't', tiles });
    const m = members.create({ name: 'Anna' });
    members.setPermissions(m.id, { revokedRooms: [garage.id] });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const home = (await app.inject({ method: 'GET', url: `${APP_API_PREFIX}/home`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(home.tiles).toEqual([{ id: 'sensors:1', kind: 'sensors', room: hall.id, name: 'Windows', icon: 'sensor_door', text: '2 of 3 open', level: 'warning', why: ['Hall window'] }]);
    expect(home.rooms.map((r: { name: string }) => r.name)).toEqual(['Hall']);
  });
});

describe('pausing alerts from the app', () => {
  it('is refused until the owner allows it, then pauses and resumes', async () => {
    const db = openDatabase(':memory:');
    const members = new Members(db);
    const alertPause = new AlertPause(db);
    const app = buildAppServer({ members, actions: new Actions(db), rooms: new Rooms(db), version: 't', alertPause });
    const m = members.create({ name: 'Anna' });
    const { token } = members.pair(members.createPairingCode(m.id).code, 'Pixel');
    const pause = (minutes: number) => app.inject({ method: 'POST', url: `${APP_API_PREFIX}/alerts/pause`, payload: { minutes }, headers: { authorization: `Bearer ${token}` } });
    expect((await pause(60)).statusCode).toBe(403);
    members.setMayPauseAlerts(m.id, true);
    const paused = (await pause(60)).json();
    expect(paused.paused.by).toBe('Anna (Pixel)');
    expect(alertPause.active()).toBe(true);
    expect((await pause(0)).json()).toEqual({ paused: null });
    expect(alertPause.active()).toBe(false);
    expect((await pause(5000)).statusCode).toBe(400);
  });
});
