import net from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { Auth, readCookie, SESSION_COOKIE } from './auth.js';
import { isLocalAddress } from './network.js';
import { Actions } from './actions.js';
import { autoIcon, UNKNOWN_ICON } from './device-icons.js';
import { Devices } from './devices.js';
import { LightGroups } from './groups.js';
import { Rules } from './rules.js';
import { RuleEngine } from './rule-engine.js';
import { RoomPhotos, Rooms } from './rooms.js';
import { DependencyIndex, loadIndexInput } from './related.js';
import type { InternalServerDeps, RouteContext } from './routes/context.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerGatewayRoutes } from './routes/gateway.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerImportRoutes } from './routes/import.js';
import { registerRelatedRoutes } from './routes/related.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerRuleRoutes } from './routes/rules.js';
import { serveWeb } from './routes/web.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerConditionRoutes } from './routes/conditions.js';
import { Checks } from './checks.js';
import { SensorGroups } from './sensor-groups.js';
import { Energy } from './energy.js';
import { History } from './history.js';
import { Notifications } from './notifications.js';
import { Members } from './members.js';
import { registerMemberRoutes } from './routes/members.js';

export type { InternalServerDeps } from './routes/context.js';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/state', '/api/auth/setup', '/api/auth/login']);

// The LAN-only listener: the web UI and the admin API. It builds the modules once and hands them to the route files
// in routes/, one per area (0015); routes only parse requests, call modules and shape replies.
export function buildInternalServer(deps: InternalServerDeps): FastifyInstance {
  const { db, version, zigbee, webRoot } = deps;
  // The core uses the device router over all gateways (0023); a single bridge stands in for it in tests.
  const control = deps.control ?? zigbee;
  const groups = deps.groups ?? new LightGroups(db, control);
  const actions = deps.actions ?? new Actions(db, control, groups);
  const rules = deps.rules ?? new Rules(db, control);
  const history = deps.history ?? new History(db);
  const energy = deps.energy ?? new Energy(db);
  const notifications = deps.notifications ?? new Notifications(db);
  const sensorGroups = deps.sensorGroups ?? new SensorGroups(db, control);
  const checks = deps.checks ?? new Checks(db);
  const engine = deps.engine ?? new RuleEngine(db, rules, { zigbee: control, actions, groups, history, notifications, sensorGroups, checks, minuteTimer: false });
  const devices = new Devices(db);
  const auth = new Auth(db);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  // The internal listener only serves the home network, whatever the router forwards.
  app.addHook('onRequest', async (req, reply) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      reply.code(403).send({ error: 'This interface is only available on the home network' });
      return reply;
    }
    // DNS rebinding: a web page on some outside name, pointed at the NAS's address, would pass the address check.
    // The home network reaches SynBee by address or by a local name, so other names are refused.
    if (!isHomeHost(req.headers.host, deps.allowedHosts)) {
      reply.code(403).send({ error: 'Open SynBee by the NAS address or its local name' });
      return reply;
    }
    // Other pages on the same NAS (another app's port) count as the same site for cookies, so changes must come
    // from SynBee's own page.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req.headers.origin, req.headers.host)) {
      reply.code(403).send({ error: 'Changes are accepted only from the SynBee page itself' });
      return reply;
    }
    // The matched route, not the raw URL, decides: Fastify decodes the path when routing, so "/%61pi/devices"
    // would otherwise reach /api/devices without looking like an API path. Unmatched paths are the web UI's.
    const route = req.routeOptions.url ?? '';
    let raw = '';
    try {
      raw = decodeURIComponent(req.url.split('?')[0]!);
    } catch {
      raw = req.url;
    }
    if (!(route.startsWith('/api/') || raw.startsWith('/api/')) || PUBLIC_PATHS.has(route)) return;
    if (auth.userForSession(readCookie(req.headers.cookie, SESSION_COOKIE)) === null) {
      reply.code(401).send({ error: 'Sign in first' });
      return reply;
    }
  });

  // API answers are never cached by the browser or sniffed as another type.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  const ctx: RouteContext = {
    db,
    version,
    zigbee,
    control,
    deps,
    networks: deps.networks ?? (() => [{ id: 1, name: 'Gateway 1', zigbee, coordinator: deps.coordinator, gateway: deps.gateway, backup: deps.backup }]),
    auth,
    devices,
    rooms: new Rooms(db),
    photos: deps.photoDir ? new RoomPhotos(db, deps.photoDir) : null,
    groups,
    actions,
    rules,
    engine,
    history,
    energy,
    notifications,
    members: deps.members ?? new Members(db),
    iconOf: (ieee) => {
      const chosen = devices.icons(ieee);
      const z = control?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee);
      const auto = autoIcon(z?.definition) ?? chosen.importIcon ?? UNKNOWN_ICON;
      return { icon: chosen.icon ?? auto, autoIcon: auto, iconChosen: Boolean(chosen.icon) };
    },
    labelsOf: (ieee) => devices.labels(ieee),
    dependencyIndex: () => new DependencyIndex(loadIndexInput(db, { actions: actions.list(), rules: rules.list(), groups: groups.list() })),
  };

  registerAuthRoutes(app, ctx);
  registerImportRoutes(app, ctx);
  registerGatewayRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerRelatedRoutes(app, ctx);
  registerRoomRoutes(app, ctx);
  registerGroupRoutes(app, ctx);
  registerRuleRoutes(app, ctx);
  registerActionRoutes(app, ctx);
  registerHistoryRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerMemberRoutes(app, ctx);
  registerConditionRoutes(app, ctx);
  if (webRoot) serveWeb(app, webRoot);
  return app;
}

const LOCAL_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain'];

/** Whether a Host header names the NAS the way the home network does: an address, localhost or a local name. */
export function isHomeHost(host: string | undefined, extra: string[] = []): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '');
  const lower = name.toLowerCase().replace(/\.$/, '');
  if (net.isIP(lower) || lower === 'localhost' || extra.map((h) => h.toLowerCase()).includes(lower)) return true;
  if (!/^[a-z0-9.-]{1,253}$/.test(lower)) return false;
  return !lower.includes('.') || LOCAL_SUFFIXES.some((s) => lower.endsWith(s));
}

/** No Origin (not a browser, or a same-origin GET) is fine; otherwise it must be this host. */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
