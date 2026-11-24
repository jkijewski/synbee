import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { LightGroups } from '../src/groups.js';
import { Notifications } from '../src/notifications.js';
import { RuleEngine } from '../src/rule-engine.js';
import { parseIf, Rules } from '../src/rules.js';
import { FakeDevices } from './fake-devices.js';

// An action's own IF (0011) and the placeholders of notification texts.
const SWITCH = '0xa4c1380000000001';
const DOOR = '0x00158d0000000101';

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
  devices.update(DOOR, { name: 'Roof window' });
  const groups = new LightGroups(db, fake);
  const actions = new Actions(db, fake, groups);
  const rules = new Rules(db, fake);
  const notifications = new Notifications(db);
  const engine = new RuleEngine(db, rules, { zigbee: fake, actions, groups, notifications, minuteTimer: false });
  actions.setConditionCheck((c) => engine.checkConditions(c));
  engine.start();
  return { db, fake, actions, rules, notifications, engine };
}

describe('action conditions', () => {
  it("doesn't run when its IF isn't met, and says what wasn't true", async () => {
    const { fake, actions } = setup();
    const heat = actions.create({
      name: 'Heat the attic',
      steps: [{ kind: 'device', device: SWITCH, values: { state_l1: 'ON' } }],
      if: parseIf({ mode: 'all', conditions: [{ type: 'state', device: DOOR, property: 'contact', op: 'eq', value: true }] }),
    });
    expect(actions.get(heat.id)!.if.conditions).toHaveLength(1);
    fake.report(DOOR, { contact: false });
    const refused = await actions.run(heat.id);
    expect(refused).toMatchObject({ ok: false, notRun: 'Roof window is Open', error: 'Not run: Roof window is Open', steps: [] });
    expect(fake.commands).toEqual([]);
    fake.report(DOOR, { contact: true });
    expect((await actions.run(heat.id)).ok).toBe(true);
    expect(fake.commands).toHaveLength(1);
    // Without conditions, nothing changes.
    expect(actions.create({ name: 'Plain', steps: [{ kind: 'device', device: SWITCH, values: { state_l1: 'OFF' } }] }).if).toEqual({ mode: 'all', conditions: [] });
  });

  it('fills notification placeholders from what started the rule', async () => {
    const { fake, rules, notifications } = setup();
    rules.create({
      name: 'Window alert',
      enabled: true,
      when: [{ type: 'state', device: DOOR, property: 'contact', to: false }],
      then: [{ type: 'notify', level: 'warning', text: '{device} is {state} ({rule}) {unknown}' }],
    });
    fake.report(DOOR, { contact: true });
    fake.report(DOOR, { contact: false });
    await until(() => notifications.list().length === 1);
    expect(notifications.list()[0]!.title).toBe('Roof window is Open (Window alert) {unknown}');
  });
});
