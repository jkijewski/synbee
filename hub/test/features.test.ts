import { afterEach, describe, expect, it } from 'vitest';
import { flattenExposes, type ExposedProperty } from '../src/exposes.js';
import { checkValues, confirms, FEATURES, featureFor, onlyLightValues, relativeKeys, translateTuya, TYPICAL_LIGHT, withLightOn } from '../src/features/index.js';
import { openDatabase } from '../src/db.js';
import { LightGroups } from '../src/groups.js';
import { Actions } from '../src/actions.js';
import { RuleEngine } from '../src/rule-engine.js';
import { Rules } from '../src/rules.js';
import { sampleBulb, sampleBulbs, sampleDevices } from '../src/sim/sample-devices.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';

const bulbProps = flattenExposes(sampleBulb('0x0000000000000001', 'b').definition!.exposes);
const prop = (name: string) => bulbProps.find((p) => p.property === name)!;

describe('feature modules', () => {
  it('recognises light features and falls back to generic ones', () => {
    expect(bulbProps.map((p) => featureFor(p).id)).toEqual(['state', 'brightness', 'color_temp', 'color']);
    const humidity: ExposedProperty = { property: 'humidity', name: 'humidity', type: 'numeric', readable: true, writable: false, unit: '%' };
    expect(featureFor(humidity)).toMatchObject({ id: 'humidity', readOnly: true });
    const unknown: ExposedProperty = { property: 'radiator_mode', name: 'mode', type: 'enum', readable: true, writable: true, values: ['a'] };
    expect(featureFor(unknown).id).toBe('enum');
    // Every module has a unique id; the last one matches anything.
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    expect(FEATURES.at(-1)!.matches({} as ExposedProperty)).toBe(true);
  });

  it('shows brightness in % and white temperature in Kelvin', () => {
    const b = featureFor(prop('brightness'));
    expect(b.toDisplay!(254, prop('brightness'))).toBe(100);
    expect(b.toDisplay!(127, prop('brightness'))).toBe(50);
    expect(b.fromDisplay!(40, prop('brightness'))).toBe(102);
    expect(b.relative!.toRaw(20, prop('brightness'))).toBe(51);
    const t = featureFor(prop('color_temp'));
    expect(t.toDisplay!(370, prop('color_temp'))).toBe(2700);
    expect(t.fromDisplay!(6500, prop('color_temp'))).toBe(154);
  });

  it('checks values, relative steps and fade times', () => {
    expect(checkValues(bulbProps, { brightness: 102, transition: 1 })).toBeNull();
    expect(checkValues(bulbProps, { brightness_step: -51, transition: 1 })).toBeNull();
    expect(checkValues(bulbProps, { color: { hex: '#ff0000' } })).toBeNull();
    expect(checkValues(bulbProps, { state: 'ON', transition: 1 })).toBeNull();
    const switchProps = flattenExposes(sampleDevices[1]!.definition!.exposes);
    expect(checkValues(switchProps, { state_l1: 'ON', transition: 1 })).toMatch(/no fade/);
    expect(checkValues(bulbProps, { brightness: 300 })).toMatch(/at most 254/);
    expect(checkValues(bulbProps, { brightness_step: 0 })).toMatch(/other than 0/);
    expect(checkValues(bulbProps, { transition: -1, brightness: 10 })).toMatch(/Fade time/);
    expect(checkValues(bulbProps, { humidity: 3 })).toMatch(/not something/);
    expect([...relativeKeys(bulbProps).keys()]).toEqual(['brightness_step', 'color_temp_step']);
  });

  it('confirms numbers within the feature tolerance', () => {
    expect(confirms(prop('brightness'), 102, 103)).toBe(true);
    expect(confirms(prop('brightness'), 102, 120)).toBe(false);
    expect(confirms(prop('state'), 'ON', 'ON')).toBe(true);
    expect(confirms(prop('color'), { hex: '#ff0000' }, { x: 0.7, y: 0.3 })).toBe(true);
  });

  it('translates Tuya data points through the modules', () => {
    const notes: string[] = [];
    expect(translateTuya('switch_2', 'toggle', notes)).toEqual({ state_l2: 'TOGGLE' });
    expect(translateTuya('switch_led', true, notes)).toEqual({ state: 'ON' });
    expect(translateTuya('bright_value', 500, notes)).toEqual({ brightness: 127 });
    expect(translateTuya('colour_data', '000003e803e8', notes)).toEqual({ color: { hue: 0, saturation: 100 }, brightness: 254 });
    expect(translateTuya('music_data', 'x', notes)).toBeNull();
    expect(notes.at(-1)).toMatch(/Not translated: music_data/);
  });
});

let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
let engine: RuleEngine | undefined;
afterEach(async () => {
  engine?.stop();
  await bridge?.stop();
  await sim?.close();
  sim = bridge = engine = undefined;
});

describe('lights end to end', () => {
  const BULB = sampleBulbs[2]!.ieee_address;
  async function setup() {
    const db = openDatabase(':memory:');
    sim = await startSimulator({ devices: [...structuredClone(sampleDevices), ...structuredClone(sampleBulbs)] });
    bridge = new ZigbeeBridge(db, sim.url);
    await bridge.start();
    const end = Date.now() + 3000;
    while (bridge.knownDevices().length < 6 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    return db;
  }

  it('sets brightness with a fade, accepts a rounded report, and steps relatively', async () => {
    await setup();
    // The simulated bulb reports 103 for 102, as real bulbs round.
    expect((await bridge!.command(BULB, { brightness: 102, transition: 1 })).brightness).toBe(103);
    expect((await bridge!.command(BULB, { brightness_step: 51 })).brightness).toBe(154);
    expect((await bridge!.command(BULB, { color_temp: 370 })).color_temp).toBe(370);
    expect((await bridge!.command(BULB, { color: { hex: '#ff8800' } })).color_mode).toBe('xy');
  });

  it('dims a whole light group relatively', async () => {
    const db = await setup();
    const groups = new LightGroups(db, bridge);
    const g = await groups.create({ name: 'salon światła', members: sampleBulbs.map((b) => b.ieee_address) });
    const end = Date.now() + 3000;
    while ((bridge!.groups()[0]?.members.length ?? 0) < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    await groups.command(g.id, { brightness: 254 });
    await groups.command(g.id, { brightness_step: -51, transition: 1 });
    const until = Date.now() + 2000;
    while (bridge!.deviceState(BULB)?.brightness !== 203 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(bridge!.deviceState(BULB)?.brightness).toBe(203);
  });

  it('runs "double press: off if on, else full" with a stop step, and checks "between"', async () => {
    const db = await setup();
    const rules = new Rules(db, bridge);
    engine = new RuleEngine(db, rules, { zigbee: bridge, actions: new Actions(db, bridge), minuteTimer: false });
    engine.start();
    const rule = rules.create({
      name: 'full or off',
      enabled: false,
      when: [{ type: 'button', device: '0xa4c1380000000002', button: 1, press: 'double_click' }],
      then: [
        { type: 'device', device: BULB, values: { state: 'OFF', transition: 1 }, onlyIf: { type: 'state', device: BULB, property: 'state', op: 'eq', value: 'ON' }, stop: true },
        { type: 'device', device: BULB, values: { state: 'ON', brightness: 254, transition: 1 } },
      ],
    });
    await bridge!.command(BULB, { state: 'OFF' });
    expect((await engine.test(rule.id)).steps.map((s) => s.status)).toEqual(['skipped', 'done']);
    expect(bridge!.deviceState(BULB)).toMatchObject({ state: 'ON', brightness: 254 });
    const second = await engine.test(rule.id);
    expect(second.steps.map((s) => s.status)).toEqual(['done', 'not run']);
    expect(bridge!.deviceState(BULB)?.state).toBe('OFF');

    const between = rules.create({
      name: 'mid',
      when: [{ type: 'every', minutes: 5 }],
      if: { mode: 'all', conditions: [{ type: 'state', device: BULB, property: 'brightness', op: 'between', value: [100, 200] }] },
      then: [{ type: 'wait', seconds: 1 }],
    });
    await bridge!.command(BULB, { brightness: 150 });
    expect((await engine.test(between.id)).conditions[0]).toMatchObject({ met: true, condition: expect.stringMatching(/between 100 and 200/) });
    expect(() => rules.create({ name: 'bad', when: [{ type: 'every', minutes: 5 }], if: { mode: 'all', conditions: [{ type: 'state', device: BULB, property: 'brightness', op: 'between', value: [200, 100] }] }, then: [{ type: 'wait', seconds: 1 }] })).toThrow(/smaller first/);
  });
  it('edits imported light steps as a usual colour bulb until the lights have joined', () => {
    expect(TYPICAL_LIGHT).toEqual(flattenExposes(sampleBulb('0x1', 'b').definition!.exposes));
    expect(onlyLightValues({ color: { hex: '#ff0000' }, brightness: 254, transition: 1 })).toBe(true);
    expect(onlyLightValues({ brightness_step: -51 })).toBe(true);
    expect(onlyLightValues({ state_l1: 'ON' })).toBe(false);
    expect(onlyLightValues({})).toBe(false);
  });

  it('switches a light on when a colour, brightness or white temperature is chosen', () => {
    expect(withLightOn(TYPICAL_LIGHT, { color: { hex: '#ff0000' } })).toEqual({ state: 'ON', color: { hex: '#ff0000' } });
    expect(withLightOn(TYPICAL_LIGHT, { brightness: 50, state: 'OFF' })).toEqual({ brightness: 50, state: 'OFF' });
    expect(withLightOn(TYPICAL_LIGHT, { state: 'TOGGLE' })).toEqual({ state: 'TOGGLE' });
    expect(withLightOn([], { brightness: 50 })).toEqual({ brightness: 50 });
  });
});
