import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { GroupError, LightGroups } from '../src/groups.js';
import { sampleDevices, sampleFadingBulb, sampleWz5 } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { isTuyaDatapoint, supportsFade } from '../src/device-kinds.js';
import { ZigbeeBridge } from '../src/zigbee.js';

// Seen on a real network with Skydance WZ5 LED controllers (TS0601): Zigbee2MQTT refuses a fade ("No converter
// available for 'transition'") and colour as a group broadcast ("Not supported for groups").
const WZ5_A = '0x60a423fffe000001';
const WZ5_B = '0x60a423fffe000002';
const BULB = '0x60a423fffe000003';
let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
afterEach(async () => {
  await bridge?.stop();
  await sim?.close();
  sim = bridge = undefined;
});

const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function setup() {
  sim = await startSimulator({ devices: [...structuredClone(sampleDevices), sampleWz5(WZ5_A, 'wz5_a'), sampleWz5(WZ5_B, 'wz5_b'), sampleFadingBulb(BULB, 'bulb')] });
  bridge = new ZigbeeBridge(openDatabase(':memory:'), sim.url);
  await bridge.start();
  await until(() => bridge!.knownDevices().length === sampleDevices.length - 1 + 3);
  return { sim, bridge };
}

describe('fades and groups by device capability', () => {
  it('knows which devices fade and which speak Tuya datapoints', () => {
    expect(supportsFade(sampleFadingBulb(BULB, 'b') as never)).toBe(true);
    expect(supportsFade(sampleWz5(WZ5_A, 'a') as never)).toBe(false);
    expect(isTuyaDatapoint(sampleWz5(WZ5_A, 'a') as never)).toBe(true);
  });

  it('drops the fade for a device that has none, and keeps it for one that has', async () => {
    const { sim, bridge } = await setup();
    await bridge.command(WZ5_A, { state: 'ON', brightness: 200, transition: 1 });
    await bridge.command(BULB, { state: 'ON', transition: 1 });
    // A Tuya datapoint light is switched on first, then gets its look (0009).
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([{ state: 'ON' }, { brightness: 200 }]);
    expect(sim.sets.find((s) => s.name === 'bulb')!.payload).toEqual({ state: 'ON', transition: 1 });
  });

  it('sends a group of Tuya datapoint devices to each member, and other groups as one broadcast', async () => {
    const { sim, bridge } = await setup();
    const wz5 = await bridge.createGroup('LED strips', [{ ieee: WZ5_A }, { ieee: WZ5_B }]);
    await until(() => bridge.groups().some((g) => g.id === wz5.id && g.members.length === 2));
    await bridge.groupCommand(wz5.id, { color: { hex: '#ff0000' }, transition: 1 });
    // Hue and saturation, not hex, for these lights; "on" first, then the look.
    const red = { color: { hue: 359, saturation: 100 } }; // 0 would mean "keep" to their converter
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([{ state: 'ON' }, { color: { hue: 358, saturation: 100 } }, red]);
    expect(sim.sets.filter((s) => s.name === 'wz5_b').map((s) => s.payload)).toEqual([{ state: 'ON' }, { color: { hue: 358, saturation: 100 } }, red]);
    expect(sim.sets.some((s) => s.name === wz5.friendly_name)).toBe(false);
    const mixed = await bridge.createGroup('Bulbs', [{ ieee: BULB }]);
    await until(() => bridge.groups().some((g) => g.id === mixed.id && g.members.length === 1));
    await bridge.groupCommand(mixed.id, { state: 'OFF', transition: 1 });
    await until(() => sim.sets.some((s) => s.name === mixed.friendly_name));
    expect(sim.sets.find((s) => s.name === mixed.friendly_name)!.payload).toEqual({ state: 'OFF', transition: 1 });
  });

  it('switches lights on with a colour temperature from a step, for single lights and groups', async () => {
    const { sim, bridge } = await setup();
    await bridge.command(BULB, { color_temp: 370 });
    expect(sim.sets.find((s) => s.name === 'bulb')!.payload).toEqual({ state: 'ON', color_temp: 370 });
    const g = await bridge.createGroup('Strips', [{ ieee: WZ5_A }, { ieee: WZ5_B }]);
    await until(() => bridge.groups().some((x) => x.id === g.id && x.members.length === 2));
    await bridge.groupCommand(g.id, { color_temp: 370 });
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([{ state: 'ON' }, { color_temp: 369 }, { color_temp: 370 }]);
  });

  it('switches a WZ5 on first, then sends its colour, then the colour brightness, each on its own', async () => {
    const { sim, bridge } = await setup();
    await bridge.command(WZ5_A, { color: { hex: '#ff3b30' }, brightness: 135 });
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([
      { state: 'ON' },
      { color: { hue: 2, saturation: 81 } }, // a slightly different colour first: an unchanged one is ignored
      { color: { hue: 3, saturation: 81 } },
      { brightness: 135 },
    ]);
  });

  it('switches a WZ5 on first, then sends white temperature, then white brightness', async () => {
    const { sim, bridge } = await setup();
    await bridge.command(WZ5_A, { color_temp: 370, brightness: 254 });
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([{ state: 'ON' }, { color_temp: 369 }, { color_temp: 370 }, { white_brightness: 254 }]);
  });

  it('remembers whether a WZ5 shows colour or white from what it was sent', async () => {
    const { bridge } = await setup();
    expect(bridge.lightMode(WZ5_A)).toBeNull();
    await bridge.command(WZ5_A, { color_temp: 370 });
    expect(bridge.lightMode(WZ5_A)).toBe('white');
    await bridge.command(WZ5_A, { color: { hex: '#ff0000' } });
    expect(bridge.lightMode(WZ5_A)).toBe('color');
  }, 20000);

  it('gives each member of a mixed Tuya group only what it can do, like a broadcast would', async () => {
    const { sim, bridge } = await setup();
    const g = await bridge.createGroup('Mixed', [{ ieee: WZ5_A }, { ieee: BULB }]);
    await until(() => bridge.groups().some((x) => x.id === g.id && x.members.length === 2));
    await bridge.groupCommand(g.id, { white_brightness: 100 });
    expect(sim.sets.filter((s) => s.name === 'wz5_a').map((s) => s.payload)).toEqual([{ state: 'ON' }, { white_brightness: 100 }]);
    expect(sim.sets.some((s) => s.name === 'bulb')).toBe(false);
  });

  it('changes members one device at a time and names a device that did not answer', async () => {
    const { sim, bridge } = await setup();
    const db = openDatabase(':memory:');
    const devices = new Devices(db);
    for (const d of bridge.knownDevices()) devices.addPaired(d.ieee_address, d.friendly_name);
    const groups = new LightGroups(db, bridge);
    const g = await groups.create({ name: 'LED strips', members: [{ ieee: WZ5_A }] });
    await until(() => bridge.groups().some((x) => x.members.length === 1));
    sim.setOffline('wz5_b', true);
    const err = await groups.setMembers(g.id, [{ ieee: WZ5_A }, { ieee: WZ5_B }, { ieee: BULB }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroupError);
    expect((err as GroupError).status).toBe(502);
    expect((err as GroupError).message).toMatch(/Not changed for wz5_b \(.*Delivery failed.*\)/);
    await until(() => (bridge.groups()[0]?.members.length ?? 0) === 2);
    expect(bridge.groups()[0]!.members.map((m) => m.ieee_address).sort()).toEqual([WZ5_A, BULB].sort());
    await groups.setMembers(g.id, [{ ieee: BULB }]);
    await until(() => bridge.groups()[0]!.members.length === 1);
  });

  it('sends a missed command once more, with a toggle as its target value, but never repeats a relative step', async () => {
    const { sim, bridge } = await setup();
    await bridge.command(WZ5_A, { state: 'OFF' });
    sim.dropNext('wz5_a');
    await bridge.command(WZ5_A, { state: 'TOGGLE' });
    expect(bridge.deviceState(WZ5_A)).toMatchObject({ state: 'ON' });
    expect(sim.sets.filter((s) => s.name === 'wz5_a').slice(-2).map((s) => s.payload)).toEqual([{ state: 'TOGGLE' }, { state: 'ON' }]);
    sim.dropNext('wz5_a');
    await expect(bridge.command(WZ5_A, { brightness_step: 20 })).rejects.toThrow(/did not confirm/);
    expect(sim.sets.filter((s) => s.name === 'wz5_a').slice(-1)[0]!.payload).toEqual({ brightness_step: 20 });
  }, 15000);
});
