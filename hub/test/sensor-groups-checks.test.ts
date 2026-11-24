import { describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { Checks } from '../src/checks.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { LightGroups } from '../src/groups.js';
import { Notifications } from '../src/notifications.js';
import { RuleEngine } from '../src/rule-engine.js';
import { parseIf, Rules } from '../src/rules.js';
import { SensorGroups } from '../src/sensor-groups.js';
import { FakeDevices } from './fake-devices.js';

// Sensor groups and checks (plan: checks and alerts): state in words, conditions, events and explanations.
const DOOR = '0x00158d0000000101';
const MOTION = '0x00158d0000000103';
const CLIMATE = '0x00158d0000000107';
const SWITCH = '0xa4c1380000000001';

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
  devices.update(DOOR, { name: 'Balcony door' });
  devices.update(CLIMATE, { name: 'Living room' });
  const groups = new LightGroups(db, fake);
  const actions = new Actions(db, fake, groups);
  const rules = new Rules(db, fake);
  const notifications = new Notifications(db);
  const sensorGroups = new SensorGroups(db, fake);
  const checks = new Checks(db);
  const engine = new RuleEngine(db, rules, { zigbee: fake, actions, groups, notifications, sensorGroups, checks, minuteTimer: false });
  actions.setConditionCheck((c) => engine.checkConditions(c));
  engine.start();
  return { fake, actions, rules, notifications, sensorGroups, checks, engine };
}

describe('sensor groups', () => {
  it('reads as one state in words, and refuses what isn not a yes/no sensor', () => {
    const { fake, sensorGroups } = setup();
    expect(() => sensorGroups.create({ name: 'Bad', members: [{ ieee: CLIMATE, property: 'temperature' }] })).toThrow(/yes\/no/);
    const doors = sensorGroups.create({ name: 'Doors', members: [{ ieee: DOOR, property: 'contact' }] });
    expect(doors.kind).toBe('contact');
    expect(() => sensorGroups.create({ name: 'doors', members: [{ ieee: DOOR, property: 'contact' }] })).toThrow(/already exists/);
    fake.report(DOOR, { contact: true });
    expect(sensorGroups.status(doors.id)).toMatchObject({ value: 'none', text: 'Closed', level: 'fine' });
    fake.report(DOOR, { contact: false });
    expect(sensorGroups.status(doors.id)).toMatchObject({ value: 'all', text: 'Open', level: 'warning' });
    // The owner's words, and several sensors counted.
    const words = sensorGroups.update(doors.id, { name: 'Doors', labels: { active: 'otwarte', inactive: 'zamknięte' }, members: [{ ieee: DOOR, property: 'contact' }] });
    expect(sensorGroups.status(words.id)!.text).toBe('Otwarte');
    const mixed = sensorGroups.create({ name: 'Mixed', members: [{ ieee: DOOR, property: 'contact' }, { ieee: MOTION, property: 'occupancy' }] });
    expect(mixed.kind).toBe('binary');
  });

  it('starts automations when it changes, and serves as a condition', async () => {
    const { fake, rules, notifications, sensorGroups } = setup();
    fake.report(DOOR, { contact: true });
    const doors = sensorGroups.create({ name: 'Doors', members: [{ ieee: DOOR, property: 'contact' }] });
    rules.create({ name: 'Door alert', enabled: true, when: [{ type: 'sensors', group: doors.id, becomes: 'all' }], then: [{ type: 'notify', level: 'warning', text: '{device}: {state}' }] });
    // A new rule is picked up on the next change; the first report only records the value.
    fake.report(DOOR, { contact: true, battery: 90 });
    fake.report(DOOR, { contact: false });
    await until(() => notifications.list().length === 1);
    expect(notifications.list()[0]!.title).toBe('Doors: Open');
  });
});

describe('checks', () => {
  it('is true or false in the owner words, explains why, and guards an action', async () => {
    const { fake, actions, checks, engine, sensorGroups } = setup();
    fake.report(DOOR, { contact: false });
    fake.report(CLIMATE, { temperature: 18.5 });
    const doors = sensorGroups.create({ name: 'Windows', members: [{ ieee: DOOR, property: 'contact' }] });
    const closed = checks.create({
      name: 'Windows closed',
      if: parseIf({ mode: 'all', conditions: [{ type: 'sensors', group: doors.id, is: 'none' }] }),
      whenTrue: { text: 'All windows closed', level: 'fine' },
      whenFalse: { text: 'A window is open', level: 'warning' },
    });
    expect(engine.evaluateCheck(closed.id)).toMatchObject({ value: false, text: 'A window is open', level: 'warning', why: [{ text: 'Windows: Open' }] });
    expect(() => checks.create({ name: 'Nested', if: parseIf({ mode: 'all', conditions: [{ type: 'check', check: closed.id, is: true }] }) })).toThrow(/another check/);
    const cold = checks.create({
      name: 'Cold',
      if: parseIf({ mode: 'all', conditions: [{ type: 'state', device: CLIMATE, property: 'temperature', op: 'lt', value: 20 }] }),
      whenTrue: { text: 'Cold', level: 'warning' },
    });
    expect(engine.evaluateCheck(cold.id)).toMatchObject({ value: true, why: [{ text: 'Living room is 18.5 °C' }] });
    const heat = actions.create({
      name: 'Heat',
      steps: [{ kind: 'device', device: SWITCH, values: { state_l1: 'ON' } }],
      if: parseIf({ mode: 'all', conditions: [{ type: 'check', check: closed.id, is: true }] }),
    });
    expect(await actions.run(heat.id)).toMatchObject({ ok: false, notRun: '"Windows closed" isn\'t true' });
    fake.report(DOOR, { contact: true });
    expect((await actions.run(heat.id)).ok).toBe(true);
  });
});
