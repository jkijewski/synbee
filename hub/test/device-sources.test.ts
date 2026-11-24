import { describe, expect, it } from 'vitest';
import { DeviceSources, GROUP_SPAN } from '../src/device-sources.js';
import { Networks } from '../src/networks.js';
import { baseTopic, coordinatorAddress, gatewaySettings, networkIds, suffix, z2mEnv } from '../supervisor/z2m.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeDevices } from './fake-devices.js';

// Several gateways behind one router (0023): the core sees one set of devices and groups.
const [A, B] = ['0x60a423fffe000001', '0x60a423fffe000002'];

function two() {
  const one = new FakeDevices([A]);
  const second = new FakeDevices([B]);
  const sources = new DeviceSources([
    { id: 1, source: one },
    { id: 2, source: second },
  ]);
  return { one, second, sources };
}

describe('device sources', () => {
  it("lists every gateway's devices and sends each command to the gateway that knows the device", async () => {
    const { one, second, sources } = two();
    expect(sources.knownDevices().map((d) => d.ieee_address)).toEqual([A, B]);
    expect(sources.sourceOf(B)?.id).toBe(2);
    await sources.command(B, { state: 'ON' });
    expect(second.commands).toEqual([{ target: B, values: { state: 'ON' } }]);
    expect(one.commands).toEqual([]);
    expect(sources.deviceState(B)).toMatchObject({ state: 'ON' });
    await expect(sources.command('0x0000000000000009', { state: 'ON' })).rejects.toThrow(/Unknown device/);
  });

  it('passes on events, saying which gateway came and went', () => {
    const { one, second, sources } = two();
    const seen: unknown[] = [];
    sources.on('state', (e) => seen.push(e.ieee));
    sources.on('gateway', (e) => seen.push(e));
    one.report(A, { state: 'OFF' });
    second.setGateway(false);
    expect(seen).toEqual([A, { online: false, source: 2 }]);
    expect(sources.gatewayOnline()).toBe(false);
  });

  it("keeps the first gateway's group ids, offsets the others, and splits a group across gateways", async () => {
    const { one, second, sources } = two();
    const g = await sources.createGroup('bedroom', [{ ieee: A }, { ieee: B }]);
    expect(g.id).toBe(1);
    expect(one.groups()).toHaveLength(1);
    expect(second.groups()).toHaveLength(1);
    expect(sources.groups()).toEqual([{ id: 1, friendly_name: 'bedroom', members: [{ ieee_address: A, endpoint: 1 }, { ieee_address: B, endpoint: 1 }] }]);
    await sources.groupCommand(g.id, { state: 'ON' });
    expect(sources.deviceState(A)?.state).toBe('ON');
    expect(sources.deviceState(B)?.state).toBe('ON');
    const only = await sources.createGroup('garage', [{ ieee: B }]);
    expect(only.id).toBe(GROUP_SPAN + 2);
    await sources.removeGroup(g.id);
    expect(one.groups()).toHaveLength(0);
    expect(second.groups().map((x) => x.friendly_name)).toEqual(['garage']);
  });
});

describe('gateway list and supervisor files', () => {
  it('always has gateway 1, adds up to nine, renames and removes the others', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nets-'));
    const nets = new Networks(dir);
    expect(nets.list()).toEqual([{ id: 1, name: 'Gateway 1' }]);
    expect(nets.add({ name: 'Garaż' })).toEqual({ id: 2, name: 'Garaż' });
    expect(() => nets.add({ name: 'garaż' })).toThrow(/already/);
    nets.rename(1, { name: 'Dom' });
    expect(() => nets.remove(1)).toThrow(/replaced, not removed/);
    expect(networkIds(dir)).toEqual([1, 2]);
    nets.remove(2);
    expect(networkIds(dir)).toEqual([1]);
  });

  it("gives gateway n its own files, data, topic and channel; only gateway 1 takes the wizard's address", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nets-'));
    expect([suffix(1), suffix(2), baseTopic(2)]).toEqual(['', '-2', 'zigbee2mqtt-2']);
    fs.writeFileSync(path.join(dir, 'coordinator-2'), '192.168.1.40:6638\n');
    expect(coordinatorAddress(dir, '192.168.1.30:6638', 2)).toBe('192.168.1.40:6638');
    expect(coordinatorAddress(dir, '192.168.1.30:6638', 3)).toBe('');
    expect(gatewaySettings(dir, 2).channel).toBe(20);
    const env = z2mEnv({ dataDir: '/p/z2m-2', coordinator: '192.168.1.40:6638', mqttPort: 18830, mqttPassword: 'pw', network: 2 });
    expect(env.ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC).toBe('zigbee2mqtt-2');
    expect(env.ZIGBEE2MQTT_CONFIG_MQTT_CLIENT_ID).toBe('synbee-z2m-2');
  });
});

describe('joining through a chosen device', () => {
  it('asks Zigbee2MQTT to let devices join only through that router, and keeps doing so', async () => {
    const { startSimulator } = await import('../src/sim/simulator.js');
    const { ZigbeeBridge } = await import('../src/zigbee.js');
    const { openDatabase } = await import('../src/db.js');
    const sim = await startSimulator();
    const bridge = new ZigbeeBridge(openDatabase(':memory:'), sim.url, 'zigbee2mqtt', { windowSeconds: 1, reopenEveryMs: 200 });
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.routers().length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const router = bridge.routers()[0]!;
    await expect(bridge.openPairing(60, '0x0000000000000009')).rejects.toThrow(/router/);
    const state = await bridge.openPairing(3, router.ieee_address);
    expect(state.through).toBe(router.ieee_address.toLowerCase());
    await new Promise((r) => setTimeout(r, 500));
    const asked = sim.permitJoinDevices.filter((d) => d === router.friendly_name);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    await bridge.closePairing();
    expect(bridge.pairingState().through).toBeNull();
    await bridge.stop();
    await sim.close();
  });
});
