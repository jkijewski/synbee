// Package supervisor: runs the MQTT broker in-process and the hub and Zigbee2MQTT as child processes,
// restarting each with backoff. In development, SIM=1 replaces the broker and Zigbee2MQTT with the simulator.
// Writes a health file that the package's start-stop-status script reads. SIGUSR2 restarts Zigbee2MQTT with
// the current coordinator address (the hub sends it after the "replace coordinator" step).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { applyPendingRestore, networkIds, suffix, coordinatorAddress, gatewaySettings, migrateZ2mData, z2mEnv } from './z2m.mjs';

const here = import.meta.dirname;
const env = process.env;
const dataDir = path.resolve(env.HUB_DATA ?? '');
if (!env.HUB_DATA) {
  console.error('supervisor: HUB_DATA must point to the data folder');
  process.exit(1);
}
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const logDir = path.resolve(env.HUB_LOG_DIR ?? path.join(dataDir, 'logs'));
// Keys and passwords live outside the shared data folder, where DSM users with access to the share could read them.
const secretsDir = path.resolve(env.HUB_SECRETS_DIR ?? dataDir);
fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
fs.chmodSync(secretsDir, 0o700);
const SECRET_FILES = ['mqtt-password', 'tls-key.pem', 'tls-cert.pem'];
// The signing key of an older phone sign-in, no longer used: deleted wherever an older version left it.
for (const dir of new Set([dataDir, secretsDir])) fs.rmSync(path.join(dir, 'token-signing-key'), { force: true });
if (secretsDir !== dataDir) {
  for (const name of SECRET_FILES) {
    const from = path.join(dataDir, name);
    const to = path.join(secretsDir, name);
    if (!fs.existsSync(from)) continue;
    // The share and the package folder can be different btrfs subvolumes, where rename fails, so copy then delete.
    if (!fs.existsSync(to)) fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o600);
    fs.rmSync(from);
  }
}
fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

const ports = {
  internal: Number(env.HUB_INTERNAL_PORT ?? 8090),
  mqtt: Number(env.HUB_MQTT_PORT ?? 18830),
};
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP = 3;

// Secrets generated once and kept in the data folder, readable by the package user only.
function secret(name) {
  const file = path.join(secretsDir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const mqttPassword = secret('mqtt-password');

function logStream(name) {
  const file = path.join(logDir, `${name}.log`);
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) {
      for (let i = LOG_KEEP - 1; i >= 1; i--) {
        if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      }
      fs.renameSync(file, `${file}.1`);
    }
  } catch {
    // No log yet.
  }
  return fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
}
const own = logStream('supervisor');
const log = (msg) => own.write(`${new Date().toISOString()} ${msg}\n`);

const mqttUrl = `mqtt://hub:${encodeURIComponent(mqttPassword)}@127.0.0.1:${ports.mqtt}`;
const sim = env.SIM === '1';

async function startBroker() {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  // Only clients that know the generated password may connect.
  const expected = Buffer.from(mqttPassword);
  broker.authenticate = (_client, username, password, done) => {
    const ok = username === 'hub' && Buffer.isBuffer(password) && password.length === expected.length && crypto.timingSafeEqual(password, expected);
    done(null, ok);
  };
  const server = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ports.mqtt, '127.0.0.1', resolve);
  });
  log(`broker listening on 127.0.0.1:${ports.mqtt}`);
  return async () => {
    await new Promise((r) => broker.close(r));
    await new Promise((r) => server.close(r));
  };
}

// Zigbee2MQTT's data holds the network key, so it lives in the private folder, never in the share (0006).
const z2mData = path.resolve(env.HUB_Z2M_DATA ?? path.join(secretsDir, 'zigbee2mqtt'));
const z2mDir = path.resolve(env.Z2M_DIR ?? path.join(here, '..', 'zigbee2mqtt', 'node_modules', 'zigbee2mqtt'));
const commonEnv = { ...env, HUB_DATA: dataDir, HUB_SECRETS_DIR: secretsDir, HUB_Z2M_DATA: z2mData, HUB_LOG_DIR: logDir, HUB_SUPERVISED: '1', NODE_NO_WARNINGS: '1' };
const services = [
  {
    name: 'hub',
    cmd: [process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '..', 'dist', 'index.js')]],
    env: {
      HUB_INTERNAL_PORT: String(ports.internal),
      HUB_MQTT_URL: sim ? `mqtt://127.0.0.1:${ports.mqtt}` : mqttUrl,
      HUB_WEB_ROOT: path.join(here, '..', 'dist-web'),
      HUB_Z2M_VERSION: z2mVersion(),
    },
  },
];

function z2mVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(z2mDir, 'package.json'), 'utf8')).version ?? '';
  } catch {
    return '';
  }
}

// One Zigbee2MQTT per gateway (0023). Each runs only with a coordinator address, so a fresh install never reaches for a
// radio by itself. Gateway 1 keeps the data folder it always had; gateway n uses zigbee2mqtt-n next to it.
const z2mServices = new Map();
function z2mService(network) {
  let svc = z2mServices.get(network);
  if (svc) return svc;
  const dataDir = network === 1 ? z2mData : `${z2mData}${suffix(network)}`;
  svc = {
    name: `zigbee2mqtt${suffix(network)}`,
    network,
    dataDir,
    cmd: [process.execPath, [path.join(z2mDir, 'index.js')]],
    cwd: dataDir,
    env: {},
    enabled: false,
    beforeStart() {
      try {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        const done = applyPendingRestore(dataDir);
        if (done) log(`${svc.name}: ${done}`);
      } catch (err) {
        log(`${svc.name}: could not apply the restored backup: ${err.message}`);
      }
    },
  };
  z2mServices.set(network, svc);
  services.push(svc);
  return svc;
}
function configureZ2m() {
  const wanted = networkIds(secretsDir);
  for (const network of wanted) {
    const svc = z2mService(network);
    const coordinator = coordinatorAddress(secretsDir, env.HUB_COORDINATOR, network);
    svc.enabled = coordinator !== '' && fs.existsSync(path.join(z2mDir, 'index.js'));
    svc.env = z2mEnv({ dataDir: svc.dataDir, coordinator, mqttPort: ports.mqtt, mqttPassword, gateway: gatewaySettings(secretsDir, network), network });
    if (!coordinator) log(`${svc.name} not started: no coordinator address set`);
    else if (!svc.enabled) log(`${svc.name} not started: not found in ${z2mDir}`);
    else log(`${svc.name} uses coordinator tcp://${coordinator}`);
  }
  // A gateway the hub removed: its Zigbee2MQTT stops; its data stays in the private folder.
  for (const [network, svc] of z2mServices) if (!wanted.includes(network)) svc.enabled = false;
}

if (sim) {
  services.push({
    name: 'simulator',
    cmd: [process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '..', 'dist', 'sim', 'cli.js')]],
    env: { SIM_PORT: String(ports.mqtt) },
  });
} else {
  try {
    log(`zigbee2mqtt data: ${migrateZ2mData(path.join(dataDir, 'zigbee2mqtt'), z2mData)}`);
    fs.mkdirSync(z2mData, { recursive: true, mode: 0o700 });
    fs.chmodSync(z2mData, 0o700);
    configureZ2m();
  } catch (err) {
    log(`zigbee2mqtt not started: ${err.message}`);
  }
}

let stopping = false;
const healthFile = path.join(dataDir, 'health.json');
function writeHealth() {
  const status = Object.fromEntries(services.map((s) => [s.name, { running: Boolean(s.child), enabled: s.enabled !== false, restarts: s.restarts ?? 0 }]));
  fs.writeFileSync(healthFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), services: status }));
}

function start(svc) {
  if (stopping || svc.enabled === false || svc.child) return;
  clearTimeout(svc.timer);
  svc.beforeStart?.();
  const startedAt = Date.now();
  const out = logStream(svc.name);
  const [cmd, args] = svc.cmd;
  svc.child = spawn(cmd, args, { env: { ...commonEnv, ...svc.env }, cwd: svc.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  svc.child.stdout.pipe(out);
  svc.child.stderr.pipe(out);
  // The last lines of output, so an unexpected exit is logged with its reason (the service's own log rolls over).
  const recent = [];
  const keep = (chunk) => {
    for (const line of chunk.toString().split('\n')) if (line.trim()) recent.push(line.slice(0, 300));
    recent.splice(0, Math.max(0, recent.length - 40));
  };
  svc.child.stdout.on('data', keep);
  svc.child.stderr.on('data', keep);
  log(`${svc.name} started, pid ${svc.child.pid}`);
  writeHealth();
  svc.child.on('exit', (code, signal) => {
    svc.child = null;
    out.end();
    writeHealth();
    if (stopping) return;
    if (svc.restartNow) {
      svc.restartNow = false;
      svc.delayMs = 1000;
      start(svc);
      return;
    }
    if (Date.now() - startedAt > 60000) svc.delayMs = 1000;
    svc.delayMs = svc.delayMs ?? 1000;
    svc.restarts = (svc.restarts ?? 0) + 1;
    log(`${svc.name} exited (code ${code}, signal ${signal}); restart ${svc.restarts} in ${svc.delayMs} ms`);
    const reasons = recent.filter((l) => /error|fail|exception|refused|timed? ?out/i.test(l)).slice(-5);
    for (const line of reasons.length ? reasons : recent.slice(-3)) log(`${svc.name} last output: ${line}`);
    svc.timer = setTimeout(() => start(svc), svc.delayMs);
    svc.delayMs = Math.min(svc.delayMs * 2, 30000);
  });
}

let stopBroker = async () => {};
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, stopping`);
  const running = services.filter((s) => s.child);
  await Promise.all(
    running.map(
      (s) =>
        new Promise((resolve) => {
          const t = setTimeout(() => (s.child?.kill('SIGKILL'), resolve()), 15000);
          s.child.once('exit', () => (clearTimeout(t), resolve()));
          s.child.kill('SIGTERM');
        }),
    ),
  );
  await stopBroker();
  fs.rmSync(healthFile, { force: true });
  log('stopped');
  own.end(() => process.exit(0));
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
// SIGUSR2 from the hub: gateways added, removed or changed. Every Zigbee2MQTT restarts with its current settings (a
// restart takes seconds); one whose gateway was removed stops.
process.on('SIGUSR2', () => {
  if (stopping || sim) return;
  log('SIGUSR2: restarting zigbee2mqtt with the current gateways');
  configureZ2m();
  for (const svc of z2mServices.values()) {
    if (svc.child) {
      svc.restartNow = svc.enabled;
      svc.child.kill('SIGTERM');
    } else {
      start(svc);
    }
  }
});
if (!sim) stopBroker = await startBroker();
services.forEach(start);
setInterval(writeHealth, 30000).unref();
