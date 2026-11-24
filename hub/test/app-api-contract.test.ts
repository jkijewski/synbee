import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { APP_API_PREFIX, APP_ROUTES, appApiOpenApi } from '../src/app-api-schema.js';
import { buildAppServer } from '../src/app-server.js';
import { openDatabase } from '../src/db.js';
import { Members } from '../src/members.js';
import { Rooms } from '../src/rooms.js';

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
    expect((await app.inject({ method: 'GET', url: `${APP_API_PREFIX}/home`, headers: auth })).json()).toEqual({ rooms: [], actions: [] });
    expect((await app.inject({ method: 'POST', url: `${APP_API_PREFIX}/actions/7/run`, headers: auth })).json()).toEqual({ error: 'Not found' });
  });
});
