import mqtt from 'mqtt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attentionList } from '../src/attention.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { Energy } from '../src/energy.js';
import { GATEWAY_GRACE_MS, watchDevices } from '../src/device-watchers.js';
import { History } from '../src/history.js';
import { Notifications } from '../src/notifications.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { FakeDevices } from './fake-devices.js';

// The gateway's connection, shown in the header and the attention list, and notified when it stays lost.
let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

describe('gateway connection', () => {
  it("follows Zigbee2MQTT's bridge state", async () => {
    sim = await startSimulator();
    bridge = new ZigbeeBridge(openDatabase(':memory:'), sim.url);
    await bridge.start();
    const until = async (check: () => boolean) => {
      const end = Date.now() + 3000;
      while (!check()) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await until(() => bridge!.gatewayOnline() === true);
    const events: boolean[] = [];
    bridge.on('gateway', (e: { online: boolean }) => events.push(e.online));
    // What the broker publishes for Zigbee2MQTT (its last will) when it stops because the gateway is gone.
    const client = await mqtt.connectAsync(sim.url);
    await client.publishAsync('zigbee2mqtt/bridge/state', JSON.stringify({ state: 'offline' }), { retain: true });
    await until(() => bridge!.gatewayOnline() === false);
    await client.publishAsync('zigbee2mqtt/bridge/state', JSON.stringify({ state: 'online' }), { retain: true });
    await until(() => bridge!.gatewayOnline() === true);
    expect(events).toEqual([false, true]);
    await client.endAsync();
  });

  it('counts the gateway as gone when the hub loses the broker', async () => {
    sim = await startSimulator();
    bridge = new ZigbeeBridge(openDatabase(':memory:'), sim.url);
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.gatewayOnline() !== true) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
    const events: boolean[] = [];
    bridge.on('gateway', (e: { online: boolean }) => events.push(e.online));
    await sim.close();
    sim = undefined;
    const end2 = Date.now() + 3000;
    while (events.length === 0) {
      if (Date.now() > end2) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(events).toEqual([false]);
    expect(bridge.gatewayOnline()).toBe(false);
  });

  it('puts a lost gateway first in the attention list', () => {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    fake.gateway = false;
    expect(attentionList(new Devices(db), fake)[0]).toMatchObject({ ieee: '', name: 'Zigbee gateway', level: 'alarm' });
  });

  it('notifies only when the gateway stays lost, and when it is back', async () => {
    vi.useFakeTimers();
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const notifications = new Notifications(db, () => Date.now());
    const stop = watchDevices(fake, { devices: new Devices(db), history: new History(db), energy: new Energy(db), notifications });
    fake.emit('gateway', { online: false });
    await vi.advanceTimersByTimeAsync(10_000);
    fake.emit('gateway', { online: true }); // a quick restart: nothing to say
    await vi.advanceTimersByTimeAsync(GATEWAY_GRACE_MS * 2);
    expect(notifications.list()).toHaveLength(0);
    fake.emit('gateway', { online: false });
    await vi.advanceTimersByTimeAsync(GATEWAY_GRACE_MS + 1000);
    fake.emit('gateway', { online: true });
    expect(notifications.list().map((n) => [n.level, n.title])).toEqual([
      ['info', 'Zigbee gateway connected again'],
      ['alarm', 'Zigbee gateway not connected'],
    ]);
    stop();
  });
});
