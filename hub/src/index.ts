import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { buildInternalServer } from './server.js';
import { Auth } from './auth.js';
import { ZigbeeBridge } from './zigbee.js';
import { DeviceSources } from './device-sources.js';
import { Networks, networkSuffix, networkTopic } from './networks.js';
import type { NetworkRuntime } from './routes/context.js';
import { Actions } from './actions.js';
import { LightGroups } from './groups.js';
import { Rules } from './rules.js';
import { RuleEngine } from './rule-engine.js';
import { CoordinatorBackup } from './backup.js';
import { Coordinator } from './coordinator.js';
import { Gateway } from './gateway.js';
import { APP_ACCESS_KEY, defaultAppAccess, Settings } from './settings.js';
import { Devices } from './devices.js';
import { Energy } from './energy.js';
import { History } from './history.js';
import { Notifications } from './notifications.js';
import { watchDevices } from './device-watchers.js';
import { GatewayWebCheck } from './gateway-web.js';
import { GatewayLogins } from './gateway-hardening.js';
import { buildAppServer } from './app-server.js';
import { Members } from './members.js';
import { homeAddresses } from './network.js';
import { Rooms } from './rooms.js';
import { DeviceViews } from './device-views.js';
import { DependencyIndex, loadIndexInput } from './related.js';
import { ensureTlsIdentity } from './tls.js';

// The release version, from hub/package.json next to dist/ (the package ships it too).
const VERSION = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
  const db = openDatabase(path.join(config.dataDir, 'hub.db'));
  // Forgotten password: the package's install or upgrade wizard, which only DSM administrators can run, leaves this
  // marker in the private secrets folder. A file in the shared data folder is ignored: share users must not reset it.
  const resetFile = path.join(config.secretsDir, 'reset-admin-password');
  if (fs.existsSync(resetFile)) {
    new Auth(db).resetOwnerPassword();
    fs.rmSync(resetFile, { force: true });
    console.log('hub: admin password reset from the package wizard; set a new one in the web interface');
  }
  const settings = new Settings(db);
  const z2mData = process.env.HUB_Z2M_DATA || null;
  const restartZigbee2mqtt = () => {
    if (process.env.HUB_SUPERVISED !== '1') return false;
    process.kill(process.ppid, 'SIGUSR2');
    return true;
  };
  // The gateways (0023): one Zigbee2MQTT bridge each, all behind the device router the core uses.
  const networks = new Networks(config.secretsDir);
  const sources = new DeviceSources();
  sources.on('device-joined', (d: { ieee: string; name: string }) => console.log(`hub: device joined ${d.ieee} as "${d.name}"`));
  sources.on('warning', (msg: string) => console.warn(`hub: ${msg}`));
  const runtimes = new Map<number, NetworkRuntime & { zigbee: ZigbeeBridge }>();
  const startNetwork = (id: number) => {
    const bridge = new ZigbeeBridge(db, config.mqttUrl, networkTopic(id));
    void bridge.start().then(() => console.log(`hub: connected to MQTT for gateway ${id}`));
    sources.add({ id, source: bridge });
    runtimes.set(id, {
      id,
      name: networks.get(id)?.name ?? `Gateway ${id}`,
      zigbee: bridge,
      coordinator: new Coordinator(config.secretsDir, process.env.HUB_COORDINATOR ?? '', restartZigbee2mqtt, id),
      gateway: new Gateway(config.secretsDir, bridge, id),
      backup: new CoordinatorBackup(z2mData ? `${z2mData}${networkSuffix(id)}` : null, settings, undefined, id),
    });
  };
  for (const n of networks.list()) startNetwork(n.id);
  const zigbee = runtimes.get(1)!.zigbee;
  const coordinator = runtimes.get(1)!.coordinator!;
  const networkList = () => networks.list().flatMap((n) => {
    const r = runtimes.get(n.id);
    return r ? [{ ...r, name: n.name }] : [];
  });
  const networkAdmin = {
    add(input: { name?: unknown }) {
      const n = networks.add(input);
      startNetwork(n.id);
      return n;
    },
    rename: (id: number, input: { name?: unknown }) => networks.rename(id, input),
    remove(id: number) {
      networks.remove(id);
      const r = runtimes.get(id);
      sources.remove(id);
      runtimes.delete(id);
      void r?.zigbee.stop();
      restartZigbee2mqtt();
    },
  };
  const webRoot = process.env.HUB_WEB_ROOT ?? path.join(import.meta.dirname, '..', 'dist-web');
  const groups = new LightGroups(db, sources);
  const actions = new Actions(db, sources, groups);
  const rules = new Rules(db, sources);
  const history = new History(db);
  const energy = new Energy(db);
  const notifications = new Notifications(db);
  const gatewayWeb = new GatewayWebCheck(() => coordinator.address());
  const stopWatching = watchDevices(sources, { devices: new Devices(db), history, energy, notifications, gatewayWeb, gatewayName: (id) => networks.get(id)?.name ?? null });
  const engine = new RuleEngine(db, rules, { zigbee: sources, actions, groups, history, notifications });
  engine.start();
  const members = new Members(db);
  const tls = await ensureTlsIdentity(config.secretsDir);
  const appPort = Number(process.env.HUB_APP_PORT ?? 8443);
  const app = buildInternalServer({
    db,
    version: VERSION,
    zigbee,
    control: sources,
    networks: networkList,
    networkAdmin,
    actions,
    groups,
    rules,
    engine,
    history,
    energy,
    notifications,
    backup: runtimes.get(1)!.backup,
    coordinator,
    gateway: runtimes.get(1)!.gateway,
    z2mVersion: process.env.HUB_Z2M_VERSION ?? '',
    logDir: process.env.HUB_LOG_DIR,
    photoDir: path.join(config.dataDir, 'room-photos'),
    webRoot,
    members,
    gatewayWeb,
    gatewayLogins: new GatewayLogins(config.secretsDir),
    dbFile: path.join(config.dataDir, 'hub.db'),
    snapshotDir: z2mData ? path.join(path.dirname(z2mData), 'snapshots') : undefined,
    appListener: { port: appPort, addresses: () => homeAddresses(), fingerprint: () => tls.fingerprint },
    allowedHosts: (process.env.HUB_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  });

  const rooms = new Rooms(db);
  const actionRooms = () =>
    new DependencyIndex(loadIndexInput(db, { actions: actions.list(), rules: rules.list(), groups: groups.list() })).roomMembership(rooms.list()).actions;
  const views = new DeviceViews(db, sources, groups, rooms);
  const appSettings = new Settings(db);
  const appApi = buildAppServer({
    members,
    actions,
    rooms,
    actionRooms,
    views,
    access: () => appSettings.get(APP_ACCESS_KEY, defaultAppAccess),
    homeAddresses: () => homeAddresses().map((a) => `${a}:${appPort}`),
    port: appPort,
    version: VERSION,
    https: { key: tls.key, cert: tls.cert },
  });

  const shutdown = async (signal: string) => {
    console.log(`hub: ${signal} received, stopping`);
    engine.stop();
    stopWatching();
    await app.close();
    await appApi.close();
    await Promise.all([...runtimes.values()].map((r) => r.zigbee.stop()));
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.internalPort });
  console.log(`hub: internal listener on ${config.internalPort}`);
  await appApi.listen({ host: '0.0.0.0', port: appPort });
  console.log(`hub: app listener (TLS) on ${appPort}, key fingerprint ${tls.fingerprint}`);
}

main().catch((err) => {
  console.error('hub: failed to start:', err);
  process.exit(1);
});
