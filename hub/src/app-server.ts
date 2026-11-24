import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Actions } from './actions.js';
import { APP_API_PREFIX, APP_ROUTES, componentsSchema, fastifySchema } from './app-api-schema.js';
import type { DeviceViews } from './device-views.js';
import { MemberError, type Members, type PhoneIdentity } from './members.js';
import { isLocalAddress } from './network.js';
import { RateLimiter } from './rate-limit.js';
import { roomColors } from './room-colors.js';
import type { Rooms } from './rooms.js';
import { defaultAppAccess, type AppAccess } from './settings.js';
import type { StatusTile } from './status-tiles.js';
import type { AlertPause } from './alert-pause.js';

// The app listener (0021): its own port, TLS with the hub's key, away from home only when allowed, and nothing but the app API.
// Members and phones come from members.ts; nothing here changes configuration.

export const APP_API_VERSION = 1;
const PREFIX = APP_API_PREFIX;

export interface AppServerDeps {
  members: Members;
  actions: Actions;
  rooms: Rooms;
  /** Which rooms each action belongs to: the rooms of its devices (0012). */
  actionRooms?: () => Record<number, number[]>;
  /** Device states in words, and whether actions show (0011); without it, tiles carry no state. */
  views?: DeviceViews;
  version: string;
  https?: { key: string; cert: string };
  /** Away from home (0021): whether outside connections are accepted, and where phones reach the hub there. */
  access?: () => AppAccess;
  /** The hub's home addresses as host:port, for the app's connection list. */
  homeAddresses?: () => string[];
  /** The app port, for an outside address without a port of its own. */
  port?: number;
  /** Status tiles of every room (devices, sensor groups, checks); filtered here by what the member may see. */
  tiles?: () => StatusTile[];
  /** Pausing alerts, for members the owner allows. */
  alertPause?: AlertPause;
}

export function buildAppServer({ members, actions, rooms, actionRooms, views, version, https, access = () => defaultAppAccess, homeAddresses = () => [], port = 8443, tiles = () => [], alertPause }: AppServerDeps): FastifyInstance {
  const options: FastifyServerOptions = {
    logger: false,
    bodyLimit: 16 * 1024,
    connectionTimeout: 15000,
    requestTimeout: 15000,
    keepAliveTimeout: 10000,
    trustProxy: false,
  };
  const app = (https ? Fastify({ ...options, https: { ...https, minVersion: 'TLSv1.2' } } as FastifyServerOptions) : Fastify(options)) as unknown as FastifyInstance;
  const general = new RateLimiter(120, 60_000);
  const pairings = new RateLimiter(10, 60_000);
  // Refused tokens, per address: guessing is pointless against 256-bit tokens, but it shouldn't be cheap either.
  const refusals = new RateLimiter(20, 10 * 60_000);
  const phones = new WeakMap<object, PhoneIdentity>();

  // The contract (app-api-schema.ts): answers are serialized by it, requests checked by it, and the OpenAPI document
  // is generated from it.
  app.addSchema(componentsSchema());
  // Every route must be in the contract: one added without it fails at start, not silently undocumented.
  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD') return;
    for (const m of [route.method].flat()) {
      if (!APP_ROUTES.some((r) => r.method === m && PREFIX + r.path === route.url)) throw new Error(`${m} ${route.url} is missing from app-api-schema.ts`);
    }
  });
  const schemaOf = (method: string, url: string) => {
    const route = APP_ROUTES.find((r) => r.method === method && PREFIX + r.path === url);
    if (!route) throw new Error(`${method} ${url} is missing from app-api-schema.ts`);
    return { schema: fastifySchema(route) };
  };
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err.validation) return reply.code(400).send({ error: `Invalid request: ${err.message}` });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'Something went wrong on the hub' : err.message });
  });

  // The source address is the connection's own; forwarding headers are never trusted.
  app.addHook('onRequest', async (req, reply) => {
    const ip = req.socket.remoteAddress;
    const route = req.routeOptions.url ?? '';
    // Away from home only when the owner allowed it (0021). Pairing works from anywhere: it needs a one-time code
    // the owner made in the last 10 minutes, and ping only says this is a SynBee hub.
    const pairingRoute = route === `${PREFIX}/pair` || route === `${PREFIX}/ping`;
    if (!isLocalAddress(ip) && !access().outside && !pairingRoute) {
      reply.code(403).send({ error: 'The app works on the home network only; the owner can switch on "Using the app away from home" in SynBee' });
      return reply;
    }
    if (refusals.blocked(ip ?? '')) {
      reply.code(429).send({ error: 'Too many refused requests; try again later' });
      return reply;
    }
    const wait = general.take(ip ?? '') || (route === `${PREFIX}/pair` ? pairings.take(ip ?? '') : 0);
    if (wait) {
      reply.header('Retry-After', String(wait)).code(429).send({ error: 'Too many requests' });
      return reply;
    }
    // Decided by the matched route, not the raw URL (0005). Ping and pairing are the only routes without a phone.
    if (!route.startsWith(PREFIX) || route === `${PREFIX}/ping` || route === `${PREFIX}/pair`) return;
    const phone = members.phoneForToken(req.headers.authorization);
    if (!phone) {
      refusals.take(ip ?? '');
      reply.code(401).send({ error: 'Pair this phone again' });
      return reply;
    }
    // Away from home per phone: the owner allows each phone on the App users page.
    if (!isLocalAddress(ip) && !phone.outside) {
      reply.code(403).send({ error: "This phone isn't allowed to use SynBee away from home; the owner can allow it on the App users page" });
      return reply;
    }
    phones.set(req, phone);
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));

  const phoneOf = (req: object): PhoneIdentity => {
    const phone = phones.get(req);
    if (!phone) throw Object.assign(new Error('Pair this phone again'), { statusCode: 401 });
    return phone;
  };

  // The actions this phone's member may run (0011): checked ones only, not drafts, in the owner's order.
  const allowedActions = (memberId: number) => actions.list().filter((a) => !a.draft && members.actionAllowed(memberId, a.id));

  // Lets the app check that an address is a SynBee hub, and which API it speaks, before pairing.
  app.get(`${PREFIX}/ping`, schemaOf('GET', `${PREFIX}/ping`), async () => ({ hub: 'synbee', api: APP_API_VERSION, version }));

  app.post<{ Body: { code?: unknown; phoneName?: unknown } }>(`${PREFIX}/pair`, schemaOf('POST', `${PREFIX}/pair`), async (req, reply) => {
    try {
      // A phone paired away from home is evidently meant to be used there, so it is allowed away from home at once.
      const { token, member, phone } = members.pair(req.body?.code, req.body?.phoneName, { outside: !isLocalAddress(req.socket.remoteAddress) });
      return { token, member: member.name, phone: phone.name };
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // Where the phone can reach the hub: at home, and away when the owner allowed it. The app keeps it up to date.
  app.get(`${PREFIX}/connection`, schemaOf('GET', `${PREFIX}/connection`), async (req) => {
    const phone = phoneOf(req);
    const a = access();
    const allowed = a.outside && Boolean(a.address) && phone.outside;
    return { home: homeAddresses(), outside: allowed ? [`${a.address}:${a.port ?? port}`] : [], outsideAllowed: phone.outside, hubAllowsOutside: a.outside };
  });

  // The test request: who this phone is, and how much its member may use.
  app.get(`${PREFIX}/me`, schemaOf('GET', `${PREFIX}/me`), async (req) => {
    const phone = phoneOf(req);
    return {
      member: phone.memberName,
      phone: phone.phoneName,
      hubVersion: version,
      actions: allowedActions(phone.memberId).length,
      rooms: rooms.list().filter((r) => members.roomAllowed(phone.memberId, r.id)).length,
      mayPauseAlerts: members.get(phone.memberId)?.mayPauseAlerts ?? false,
      alertsPaused: alertPause?.current() ?? null,
    };
  });

  app.get(`${PREFIX}/actions`, schemaOf('GET', `${PREFIX}/actions`), async (req) => {
    const phone = phoneOf(req);
    return allowedActions(phone.memberId).map(({ id, name, icon, description }) => ({ id, name, icon, description }));
  });

  // The app's home screen: the member's rooms, in the owner's order and with their colours, and their actions. An
  // action is under each allowed room of its devices; one without rooms is under none ("Other" in the app); one whose
  // rooms are all revoked isn't shown.
  app.get(`${PREFIX}/home`, schemaOf('GET', `${PREFIX}/home`), async (req) => {
    const phone = phoneOf(req);
    const all = rooms.list();
    const colors = roomColors(all);
    const membership = actionRooms?.() ?? {};
    const allowedRooms = all.filter((r) => members.roomAllowed(phone.memberId, r.id));
    const allowedIds = new Set(allowedRooms.map((r) => r.id));
    const list = allowedActions(phone.memberId).flatMap((a) => {
      const inRooms = membership[a.id] ?? [];
      const shown = inRooms.filter((r) => allowedIds.has(r));
      if (inRooms.length > 0 && shown.length === 0) return [];
      // state: whether its devices show what it sets (active, partly, inactive, or null when unknown); status: the tile's line.
      return [{ id: a.id, name: a.name, icon: a.icon, description: a.description, rooms: shown, state: views?.actionState(a) ?? null, power: views?.tileLook(a) ?? null, status: views?.actionStatus(a) ?? '' }];
    });
    // Status tiles in the rooms the member may see; a tile's explanation leaves out devices in rooms they can't see.
    const status = tiles()
      .filter((t) => (t.room === null ? true : allowedIds.has(t.room)) && members.tileAllowed(phone.memberId, t.id))
      .map((t) => ({ ...t, why: t.why.filter((w) => w.room === undefined || members.roomAllowed(phone.memberId, w.room)).map((w) => w.text) }));
    const used = new Set([...list.flatMap((a) => a.rooms), ...status.flatMap((t) => (t.room === null ? [] : [t.room]))]);
    return {
      rooms: allowedRooms.filter((r) => used.has(r.id)).map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: colors.get(r.id)! })),
      actions: list,
      tiles: status,
    };
  });

  // What an action touches, for the details sheet: devices and groups in words, also in rooms the member can't open
  // (they may run the action, so they may see what it switches).
  app.get<{ Params: { id: string } }>(`${PREFIX}/actions/:id/details`, schemaOf('GET', `${PREFIX}/actions/:id/details`), async (req, reply) => {
    const phone = phoneOf(req);
    const action = allowedActions(phone.memberId).find((a) => String(a.id) === req.params.id);
    if (!action) return reply.code(404).send({ error: 'Not found' });
    return { id: action.id, name: action.name, state: views?.actionState(action) ?? null, status: views?.actionStatus(action) ?? '', targets: views?.actionTargets(action) ?? [] };
  });

  // A room's devices in words, for the room page: only rooms the member may see.
  app.get<{ Params: { id: string } }>(`${PREFIX}/rooms/:id`, schemaOf('GET', `${PREFIX}/rooms/:id`), async (req, reply) => {
    const phone = phoneOf(req);
    const all = rooms.list();
    const room = all.find((r) => String(r.id) === req.params.id);
    if (!room || !members.roomAllowed(phone.memberId, room.id)) return reply.code(404).send({ error: 'Not found' });
    return { id: room.id, name: room.name, icon: room.icon, color: roomColors(all).get(room.id)!, devices: views?.room(room.id) ?? [] };
  });

  // Pause alerts (Synology Chat) for a while, or resume with 0 minutes: only for members the owner allows.
  app.post<{ Body: { minutes: number } }>(`${PREFIX}/alerts/pause`, schemaOf('POST', `${PREFIX}/alerts/pause`), async (req, reply) => {
    const phone = phoneOf(req);
    if (!alertPause || !members.get(phone.memberId)?.mayPauseAlerts) return reply.code(403).send({ error: "You may not pause alerts; the owner can allow it on the App users page" });
    try {
      const paused = alertPause.set(req.body.minutes, `${phone.memberName} (${phone.phoneName})`);
      console.log(`hub: alerts ${paused ? `paused until ${new Date(paused.until).toISOString()} by ${paused.by}` : `resumed by ${phone.memberName}`}`);
      return { paused };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>(`${PREFIX}/actions/:id/run`, schemaOf('POST', `${PREFIX}/actions/:id/run`), async (req, reply) => {
    const phone = phoneOf(req);
    const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : -1;
    // Drafts and revoked actions look exactly like missing ones.
    if (!allowedActions(phone.memberId).some((a) => a.id === id)) return reply.code(404).send({ error: 'Not found' });
    const result = await actions.run(id, { source: `app: ${phone.memberName} (${phone.phoneName})` });
    return { ok: result.ok, ...(result.ok ? {} : { failedStep: result.failedStep, error: result.error, notRun: result.notRun }) };
  });

  return app;
}
