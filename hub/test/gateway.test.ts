import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import makeMdns from 'multicast-dns';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { Coordinator } from '../src/coordinator.js';
import { discoverCoordinators, Gateway } from '../src/gateway.js';
import { buildInternalServer } from '../src/server.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';
// @ts-expect-error plain JavaScript module of the supervisor
import { gatewaySettings, z2mEnv } from '../supervisor/z2m.mjs';

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-gw-'));
  dirs.push(secrets);
  const db = openDatabase(':memory:');
  sim = await startSimulator();
  bridge = new ZigbeeBridge(db, sim.url);
  await bridge.start();
  const end = Date.now() + 3000;
  while ((bridge.knownDevices().length < 3 || !bridge.bridgeInfo()) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  const restarts: number[] = [];
  const coordinator = new Coordinator(secrets, '192.168.1.50:6638', () => (restarts.push(1), true));
  const gateway = new Gateway(secrets, bridge);
  const discover = async () => [{ name: 'SLZB-06MU', host: '192.168.1.50', address: '192.168.1.50:6638', service: '_slzb-06._tcp.local' }];
  const app = buildInternalServer({ db, version: 'test', zigbee: bridge, coordinator, gateway, z2mVersion: '2.14.3', discover });
  const headers = { cookie: await signIn(app) };
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { secrets, restarts, app, call };
}

describe('gateway page', () => {
  it('shows the coordinator, network and versions, never the network key', async () => {
    const { call, app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/gateway' })).statusCode).toBe(401);
    const res = await call('GET', '/api/gateway');
    expect(res.json()).toMatchObject({
      address: '192.168.1.50:6638',
      webPage: 'http://192.168.1.50',
      connected: true,
      zigbee2mqtt: { bundled: '2.14.3', running: '2.14.3-sim' },
      coordinator: { ieee: '0x00124b0000000001', type: 'EmberZNet', firmware: '8.0.2' },
      network: { channel: 25, panId: 4660, extendedPanId: '0xdddddddddddddddd' },
      adapterInUse: 'ember',
      devices: 3,
      settings: { adapter: 'ember', rtscts: false, channel: 25 },
    });
    expect(res.body).not.toMatch(/network_key|password/i);
  });

  it('saves adapter and flow control for Zigbee2MQTT, and changes the channel only when confirmed', async () => {
    const { call, secrets, restarts } = await setup();
    expect((await call('PUT', '/api/gateway/settings', { adapter: 'nope' })).statusCode).toBe(400);
    expect((await call('PUT', '/api/gateway/settings', { adapter: 'zstack', rtscts: true })).json()).toMatchObject({ settings: { adapter: 'zstack', rtscts: true, channel: 25 }, channelChanged: false, restarted: true });
    expect((await call('PUT', '/api/gateway/settings', { channel: 15 })).statusCode).toBe(409);
    expect((await call('PUT', '/api/gateway/settings', { channel: 30, confirmChannelChange: true })).statusCode).toBe(400);
    expect((await call('PUT', '/api/gateway/settings', { channel: 15, confirmChannelChange: true })).json()).toMatchObject({ channelChanged: true });
    expect(restarts).toHaveLength(2);
    // The supervisor reads the same file when it starts Zigbee2MQTT.
    const settings = gatewaySettings(secrets);
    expect(settings).toEqual({ adapter: 'zstack', rtscts: true, channel: 15 });
    expect(z2mEnv({ dataDir: '/d', coordinator: 'h:1', mqttPort: 1, mqttPassword: 'p', gateway: settings })).toMatchObject({
      ZIGBEE2MQTT_CONFIG_SERIAL_ADAPTER: 'zstack',
      ZIGBEE2MQTT_CONFIG_SERIAL_RTSCTS: 'true',
      ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL: '15',
    });
  });

  it('restarts the Zigbee connection, draws the network map and lists coordinators found on the network', async () => {
    const { call, restarts } = await setup();
    expect((await call('POST', '/api/gateway/restart')).json()).toEqual({ restarted: true });
    expect(restarts).toHaveLength(1);
    const map = (await call('POST', '/api/gateway/networkmap')).json();
    expect(map.nodes).toHaveLength(4);
    expect(map.links[0]).toMatchObject({ target: '0x00124b0000000001', lqi: 200 });
    expect((await call('GET', '/api/gateway/discover')).json().found[0]).toMatchObject({ address: '192.168.1.50:6638' });
  });
});

describe('finding coordinators over mDNS', () => {
  it('reads SMLIGHT-style announcements into host:port addresses', async () => {
    // A private port, so only this test's responder answers; real coordinators listen on 5353.
    const opts = { port: 15354, loopback: true };
    const responder = makeMdns(opts);
    responder.on('query', (q) => {
      if (!q.questions.some((x) => x.name === '_slzb-06._tcp.local')) return;
      responder.respond({
        answers: [{ name: '_slzb-06._tcp.local', type: 'PTR', data: 'SLZB-06MU._slzb-06._tcp.local' }],
        additionals: [
          { name: 'SLZB-06MU._slzb-06._tcp.local', type: 'SRV', data: { target: 'slzb-06mu.local', port: 6638 } },
          { name: 'slzb-06mu.local', type: 'A', data: '192.168.1.50' },
        ],
      });
    });
    try {
      const found = await discoverCoordinators({ timeoutMs: 800, mdns: opts });
      expect(found).toEqual([{ name: 'SLZB-06MU', host: '192.168.1.50', address: '192.168.1.50:6638', service: '_slzb-06._tcp.local' }]);
    } finally {
      await new Promise<void>((r) => responder.destroy(() => r()));
    }
  });
});
