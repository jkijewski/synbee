import mqtt from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';

let sim: Simulator | undefined;
afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

function nextMessage(client: mqtt.MqttClient, topic: string): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = (t: string, payload: Buffer) => {
      if (t === topic) {
        client.off('message', handler);
        resolve(JSON.parse(payload.toString()));
      }
    };
    client.on('message', handler);
  });
}

describe('Zigbee2MQTT simulator', () => {
  it('publishes retained bridge devices, including an unsupported one', async () => {
    sim = await startSimulator();
    const client = await mqtt.connectAsync(sim.url);
    const devices = nextMessage(client, 'zigbee2mqtt/bridge/devices');
    await client.subscribeAsync('zigbee2mqtt/bridge/devices');
    const list = (await devices) as Array<{ friendly_name: string; supported: boolean }>;
    expect(list.map((d) => d.friendly_name)).toContain('biurko robocze');
    expect(list.some((d) => !d.supported)).toBe(true);
    await client.endAsync();
  });

  it('applies set commands and reports state', async () => {
    sim = await startSimulator();
    const client = await mqtt.connectAsync(sim.url);
    await client.subscribeAsync('zigbee2mqtt/biurko robocze');
    const reply = nextMessage(client, 'zigbee2mqtt/biurko robocze');
    await client.publishAsync('zigbee2mqtt/biurko robocze/set', JSON.stringify({ state_l1: 'TOGGLE' }));
    expect(await reply).toEqual({ state_l1: 'ON' });
    await client.endAsync();
  });

  it('sends button presses', async () => {
    sim = await startSimulator();
    const client = await mqtt.connectAsync(sim.url);
    await client.subscribeAsync('zigbee2mqtt/Wireless Switch');
    const event = nextMessage(client, 'zigbee2mqtt/Wireless Switch');
    await sim.pressButton('Wireless Switch', '1_single');
    expect(await event).toEqual({ action: '1_single', battery: 68 });
    await client.endAsync();
  });
});
