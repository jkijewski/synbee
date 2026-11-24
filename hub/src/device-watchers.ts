import type { Devices } from './devices.js';
import type { Energy } from './energy.js';
import { flattenExposes } from './exposes.js';
import { attentionFor, featureFor } from './features/index.js';
import type { GatewayWebCheck } from './gateway-web.js';
import type { History } from './history.js';
import type { Notifications } from './notifications.js';
import type { DeviceControl, DeviceEvents } from './ports.js';

// Listens to device reports (0014): keeps reading history and energy totals, and notifies when a leak, smoke, carbon
// monoxide or gas alarm starts (when the owner left that on). History is rolled up and pruned every hour.

export interface WatcherDeps {
  devices: Devices;
  history: History;
  energy: Energy;
  notifications: Notifications;
  /** Checks whether the coordinator's web page asks for a login (0007); without it, no such check. */
  gatewayWeb?: GatewayWebCheck;
  /** A gateway's name, when there are several (0023); null for an unknown one. */
  gatewayName?: (id: number) => string | null;
  now?: () => number;
}

const HOUR = 3_600_000;
/** How often the coordinator's web page is checked for a login. */
export const GATEWAY_WEB_CHECK_MS = 30 * 60_000;
/** A Zigbee2MQTT restart takes seconds; only a longer loss of the gateway is worth a notification. */
export const GATEWAY_GRACE_MS = 120_000;

export function watchDevices(control: DeviceControl, deps: WatcherDeps): () => void {
  const now = deps.now ?? Date.now;
  const onState = (e: DeviceEvents['state']) => {
    const z = control.knownDevices().find((d) => d.ieee_address.toLowerCase() === e.ieee);
    const props = flattenExposes(z?.definition?.exposes);
    const at = now();
    try {
      deps.history.record(e.ieee, props, e.state, e.changed, at);
      const energy = e.state.energy;
      if (e.changed.includes('energy') && typeof energy === 'number' && props.some((p) => p.property === 'energy')) deps.energy.record(e.ieee, energy, at);
    } catch (err) {
      console.warn(`hub: could not record history for ${e.ieee}: ${(err as Error).message}`);
    }
    if (!deps.notifications.settings().autoAlarms) return;
    for (const p of props) {
      if (!e.changed.includes(p.property)) continue;
      const level = attentionFor(p, e.state[p.property]);
      // Only the start of an alarm; the first report after a restart is not a new alarm.
      if (level !== 'alarm' || !(p.property in e.previous) || attentionFor(p, e.previous[p.property]) === 'alarm') continue;
      const f = featureFor(p);
      const name = deps.devices.get(e.ieee)?.name ?? e.ieee;
      const word = f.words?.on ?? String(e.state[p.property]);
      deps.notifications.notify({ level: 'alarm', title: `${name}: ${f.label} ${word}`, ieee: e.ieee, dedupeKey: `alarm:${e.ieee}:${p.property}` });
    }
  };
  control.on('state', onState);
  // Each gateway: notify when it has been gone for 2 minutes (a restart takes seconds), and when it is back.
  const gatewayTimers = new Map<number, NodeJS.Timeout>();
  const gatewayReported = new Set<number>();
  const onGateway = (e: DeviceEvents['gateway']) => {
    const id = e.source ?? 1;
    const named = deps.gatewayName?.(id);
    const title = named ? `Zigbee gateway "${named}"` : 'Zigbee gateway';
    const key = id === 1 ? 'gateway' : `gateway-${id}`;
    const pending = gatewayTimers.get(id);
    if (pending) clearTimeout(pending);
    gatewayTimers.delete(id);
    if (!e.online) {
      const timer = setTimeout(() => {
        gatewayReported.add(id);
        deps.notifications.notify({
          level: 'alarm',
          title: `${title} not connected`,
          body:
            'Devices can neither be switched nor heard until it is back. Check its power and network cable. If nobody restarted or unplugged it, ' +
            "another device on the network may have taken its connection: on the gateway's own Security page, allow its socket only from this NAS.",
          dedupeKey: key,
        });
      }, GATEWAY_GRACE_MS);
      timer.unref?.();
      gatewayTimers.set(id, timer);
    } else if (gatewayReported.has(id)) {
      gatewayReported.delete(id);
      deps.notifications.notify({ level: 'info', title: `${title} connected again`, dedupeKey: `${key}-back` });
    }
    if (e.online && id === 1) void checkWeb();
  };
  // The coordinator's web page: a warning when it opens without a login, once each time it becomes open.
  let webWasOpen = false;
  const checkWeb = async () => {
    if (!deps.gatewayWeb) return;
    const s = await deps.gatewayWeb.check();
    if (s.web === 'open' && !webWasOpen) {
      deps.notifications.notify({
        level: 'warning',
        title: "The gateway's web page has no password",
        body: `Anyone on your network can open ${s.url} and change the gateway's settings. On its Security page, turn on web server authentication, and allow its socket only from this NAS.`,
        dedupeKey: 'gateway-web-open',
      });
    }
    if (s.web !== 'unknown' && s.web !== 'unreachable') webWasOpen = s.web === 'open';
  };
  const firstWebCheck = setTimeout(() => void checkWeb(), 30_000);
  firstWebCheck.unref?.();
  const webChecks = setInterval(() => void checkWeb(), GATEWAY_WEB_CHECK_MS);
  webChecks.unref?.();
  control.on('gateway', onGateway);
  const maintenance = setInterval(() => {
    try {
      deps.history.maintain(now());
    } catch (err) {
      console.warn(`hub: history maintenance failed: ${(err as Error).message}`);
    }
  }, HOUR);
  maintenance.unref?.();
  return () => {
    control.off('state', onState);
    control.off('gateway', onGateway);
    for (const t of gatewayTimers.values()) clearTimeout(t);
    clearTimeout(firstWebCheck);
    clearInterval(webChecks);
    clearInterval(maintenance);
  };
}
