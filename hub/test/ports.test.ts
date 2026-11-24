import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { LightGroups } from '../src/groups.js';
import { RuleEngine } from '../src/rule-engine.js';
import { Rules } from '../src/rules.js';
import { FakeDevices } from './fake-devices.js';

// Rules, actions and light groups depend on the device and group ports (0015), not on the Zigbee2MQTT bridge, so
// they run here against an in-memory fake: no MQTT broker, no simulator.
const SWITCH = '0xa4c1380000000001';
const REMOTE = '0xa4c1380000000002';
const BULBS = ['0x60a423fffe000001', '0x60a423fffe000002'];

const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function setup() {
  const db = openDatabase(':memory:');
  const fake = new FakeDevices();
  const devices = new Devices(db);
  for (const d of fake.knownDevices()) devices.addPaired(d.ieee_address, d.friendly_name);
  const groups = new LightGroups(db, fake);
  const actions = new Actions(db, fake, groups);
  const rules = new Rules(db, fake);
  const engine = new RuleEngine(db, rules, { zigbee: fake, actions, groups, minuteTimer: false });
  engine.start();
  return { db, fake, groups, actions, rules, engine };
}

describe('modules against the device ports', () => {
  it('runs a button rule that toggles a switch channel', async () => {
    const { fake, rules, engine } = setup();
    const rule = rules.create({
      name: 'Button 1 toggles channel 1',
      enabled: true,
      when: [{ type: 'button', device: REMOTE, button: 1, press: 'single_click' }],
      then: [{ type: 'device', device: SWITCH, values: { state_l1: 'TOGGLE' } }],
    });
    fake.pressButton(REMOTE, '1_single');
    await until(() => engine.history(rule.id, 1)[0]?.outcome === 'completed');
    expect(fake.deviceState(SWITCH)).toMatchObject({ state_l1: 'ON' });
    engine.stop();
  });

  it('runs an action with a light group step, and starts a rule from a state change', async () => {
    const { fake, groups, actions, rules, engine } = setup();
    const group = await groups.create({ name: 'salon', members: BULBS.map((ieee) => ({ ieee })) });
    const action = actions.create({ name: 'Bright', steps: [{ kind: 'group', group: group.id, values: { state: 'ON', brightness: 254 } }] });
    const rule = rules.create({
      name: 'Bulb on → channel 2 on',
      enabled: true,
      when: [{ type: 'state', device: BULBS[0], property: 'state', to: 'ON' }],
      then: [{ type: 'device', device: SWITCH, values: { state_l2: 'ON' } }],
    });
    fake.report(BULBS[0]!, { state: 'OFF' });
    expect(await actions.run(action.id)).toMatchObject({ ok: true });
    expect(fake.commands[0]).toEqual({ target: group.id, values: { state: 'ON', brightness: 254 } });
    await until(() => engine.history(rule.id, 1)[0]?.outcome === 'completed');
    expect(fake.deviceState(SWITCH)).toMatchObject({ state_l2: 'ON' });
    engine.stop();
  });
});
