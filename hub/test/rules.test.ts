import { afterEach, describe, expect, it } from 'vitest';
import { Actions } from '../src/actions.js';
import { openDatabase, type Db } from '../src/db.js';
import { LightGroups } from '../src/groups.js';
import { HOP_LIMIT, KEEP_RUNS, RuleEngine } from '../src/rule-engine.js';
import { parseRule, RuleError, Rules } from '../src/rules.js';
import { buildInternalServer } from '../src/server.js';
import { startSimulator, type Simulator } from '../src/sim/simulator.js';
import { ZigbeeBridge } from '../src/zigbee.js';
import { signIn } from './helpers.js';

const SWITCH = '0xa4c1380000000001';
const REMOTE = '0xa4c1380000000002';
let sim: Simulator | undefined;
let bridge: ZigbeeBridge | undefined;
let engine: RuleEngine | undefined;
afterEach(async () => {
  engine?.stop();
  await bridge?.stop();
  await sim?.close();
  sim = bridge = engine = undefined;
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function setup(options: { now?: () => Date } = {}) {
  const db = openDatabase(':memory:');
  sim = await startSimulator();
  bridge = new ZigbeeBridge(db, sim.url);
  await bridge.start();
  await until(() => bridge!.knownDevices().length === 3);
  const groups = new LightGroups(db, bridge);
  const actions = new Actions(db, bridge, groups);
  const rules = new Rules(db, bridge);
  engine = new RuleEngine(db, rules, { zigbee: bridge, actions, groups, minuteTimer: false, ...options });
  engine.start();
  return { db, actions, rules, engine };
}

const press = (raw: string) => sim!.pressButton('Wireless Switch', raw);
const state = (prop: string) => bridge!.deviceState(SWITCH)?.[prop];
const runs = (db: Db, ruleId: number) =>
  db.prepare('SELECT outcome, reason, trigger_text AS trigger, test FROM rule_runs WHERE rule_id = ? ORDER BY id').all(ruleId) as Array<{
    outcome: string;
    reason: string;
    trigger: string;
    test: number;
  }>;
const button1 = { type: 'button', device: REMOTE, button: 1, press: 'single_click' };
const toggle1 = { type: 'device', device: SWITCH, values: { state_l1: 'TOGGLE' } };

describe('rule validation', () => {
  it('accepts a full rule and refuses broken ones', () => {
    const ok = parseRule({
      name: 'Evening desk',
      enabled: true,
      when: [button1, { type: 'time', at: '22:30', days: [1, 2, 3, 4, 5] }, { type: 'every', minutes: 15 }, { type: 'event', name: 'evening started' }],
      if: { mode: 'any', conditions: [{ type: 'time', from: '18:00', to: '06:00' }, { type: 'days', days: [6, 7] }] },
      then: [toggle1, { type: 'wait', seconds: 5 }, { type: 'event', name: 'desk done', onlyIf: { type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'ON' } }],
    });
    expect(ok.when).toHaveLength(4);
    const bad = (patch: object) => () => parseRule({ name: 'x', when: [button1], then: [toggle1], ...patch });
    expect(bad({ name: '' })).toThrow(RuleError);
    expect(bad({ when: [] })).toThrow(/1 to 10 events/);
    expect(bad({ then: [] })).toThrow(/1 to 20 steps/);
    expect(bad({ when: [{ type: 'time', at: '25:00', days: [1] }] })).toThrow(/HH:MM/);
    expect(bad({ when: [{ type: 'time', at: '10:00', days: [] }] })).toThrow(/weekday/);
    expect(bad({ when: [{ ...button1, press: 'triple' }] })).toThrow(/single_click/);
    expect(bad({ when: [{ type: 'nope' }] })).toThrow(/unknown event/);
    expect(bad({ if: { mode: 'some', conditions: [] } })).toThrow(/"all" or "any"/);
    expect(bad({ if: { mode: 'all', conditions: [{ type: 'state', device: SWITCH, property: 'state_l1', op: 'gt', value: 'ON' }] } })).toThrow(/number/);
    expect(bad({ then: [{ type: 'wait', seconds: 0 }] })).toThrow(/wait/);
    expect(bad({ then: [{ type: 'device', device: 'kitchen', values: { state: 'ON' } }] })).toThrow(/choose a device/);
    // A draft is never enabled.
    expect(parseRule({ name: 'x', draft: true, enabled: true, when: [button1], then: [toggle1] }).enabled).toBe(false);
  });

  it('checks rules against device capabilities when they are enabled', async () => {
    const { rules } = await setup();
    expect(() => rules.create({ name: 'x', enabled: true, when: [{ ...button1, button: 7 }], then: [toggle1] })).toThrow(/has no button 7/);
    expect(() => rules.create({ name: 'x', enabled: true, when: [button1], then: [{ type: 'device', device: SWITCH, values: { state_l9: 'ON' } }] })).toThrow(
      /state_l9 is not something this can do/,
    );
    expect(() => rules.create({ name: 'x', enabled: true, when: [button1], then: [{ type: 'device', device: SWITCH, values: { state_l1: 'MAYBE' } }] })).toThrow(
      /must be one of/,
    );
    expect(rules.create({ name: 'ok', enabled: true, when: [button1], then: [toggle1] }).warnings).toEqual([]);
  });

  it('flags rules whose device disappeared, and refuses to enable rules whose devices have not moved yet', async () => {
    const { db, rules } = await setup();
    const rule = rules.create({ name: 'desk', enabled: true, when: [button1], then: [toggle1] });
    db.prepare('DELETE FROM devices WHERE ieee = ?').run(SWITCH);
    expect(rules.list()[0]!.warnings).toEqual([`THEN 1: the device ${SWITCH} no longer exists`]);
    db.prepare("INSERT INTO devices (ieee, name, status, source) VALUES (?, 'biurko robocze', 'pending', 'tuya-import')").run(SWITCH);
    const draft = rules.create({ name: 'draft', draft: true, when: [button1], then: [toggle1] });
    expect(draft.readiness).toEqual({ ready: false, missing: ['biurko robocze (not moved yet)'] });
    expect(() => rules.setEnabled(draft.id, true)).toThrow(/Can't enable yet: biurko robocze/);
    db.prepare("UPDATE devices SET status = 'joined'").run();
    expect(rules.setEnabled(draft.id, true)).toMatchObject({ enabled: true, draft: false });
    expect(rules.get(rule.id)!.enabled).toBe(true);
  });
});

describe('rule engine', () => {
  it('runs the MVP rule: button 1 single_click toggles channel 1, and ignores other presses', async () => {
    const { db, rules } = await setup();
    const rule = rules.create({ name: 'Button 1 toggles desk channel 1', enabled: true, when: [button1], then: [toggle1] });
    await press('1_single');
    await until(() => runs(db, rule.id).length === 1 && runs(db, rule.id)[0]!.outcome === 'completed');
    expect(state('state_l1')).toBe('ON');
    await press('1_double');
    await press('2_single');
    await new Promise((r) => setTimeout(r, 200));
    expect(runs(db, rule.id)).toHaveLength(1);
    await press('1_single');
    await until(() => runs(db, rule.id).length === 2 && runs(db, rule.id)[1]!.outcome === 'completed');
    expect(state('state_l1')).toBe('OFF');
    expect(runs(db, rule.id)[0]!.trigger).toBe('Wireless Switch button 1 single_click');
  });

  it('does nothing, and records nothing, for a disabled rule', async () => {
    const { db, rules } = await setup();
    const rule = rules.create({ name: 'off', enabled: false, when: [button1], then: [toggle1] });
    await press('1_single');
    await new Promise((r) => setTimeout(r, 200));
    expect(runs(db, rule.id)).toEqual([]);
  });

  it('starts on a state change to a value, not on the first value or the opposite change', async () => {
    const { db, rules } = await setup();
    const rule = rules.create({
      name: 'ch1 on',
      enabled: true,
      when: [{ type: 'state', device: SWITCH, property: 'state_l1', to: 'ON' }],
      then: [{ type: 'device', device: SWITCH, values: { state_l2: 'ON' } }],
    });
    await bridge!.command(SWITCH, { state_l1: 'OFF' }); // first value seen: not a change
    await bridge!.command(SWITCH, { state_l1: 'ON' });
    await until(() => runs(db, rule.id).some((r) => r.outcome === 'completed'));
    expect(state('state_l2')).toBe('ON');
    await bridge!.command(SWITCH, { state_l1: 'OFF' });
    await new Promise((r) => setTimeout(r, 200));
    expect(runs(db, rule.id)).toHaveLength(1);
    expect(runs(db, rule.id)[0]!.trigger).toBe('biurko robocze state_l1 became ON');
  });

  it('starts when a value crosses a threshold', async () => {
    const { db, rules, engine } = await setup();
    const rule = rules.create({
      name: 'battery low',
      enabled: true,
      when: [{ type: 'state', device: REMOTE, property: 'battery', below: 30 }],
      then: [{ type: 'event', name: 'battery low' }],
    });
    await press('3_hold'); // battery 68 from the simulator
    sim!.devices; // keep the remote known
    const fakeState = (battery: number) =>
      (bridge as unknown as { onDeviceMessage(n: string, p: object): void }).onDeviceMessage('Wireless Switch', { battery });
    fakeState(50);
    fakeState(25);
    fakeState(20);
    fakeState(40);
    fakeState(10);
    await until(() => runs(db, rule.id).length === 2);
    expect(engine.history(rule.id).every((r) => r.trigger === 'Wireless Switch battery fell below 30')).toBe(true);
  });

  it('runs at a set time on chosen weekdays and every N minutes, in local time', async () => {
    const { db, rules, engine } = await setup();
    const weekdays = rules.create({ name: '22:30', enabled: true, when: [{ type: 'time', at: '22:30', days: [1, 2, 3, 4, 5] }], then: [toggle1] });
    const every = rules.create({ name: 'every 15', enabled: true, when: [{ type: 'every', minutes: 15 }], then: [{ type: 'event', name: 'tick' }] });
    const settle = () => new Promise((r) => setTimeout(r, 100));
    engine.tick(new Date(2026, 10, 17, 22, 30)); // Tuesday
    await settle();
    engine.tick(new Date(2026, 10, 21, 22, 30)); // Saturday
    await settle();
    engine.tick(new Date(2026, 10, 17, 22, 31));
    await settle();
    expect(runs(db, weekdays.id)).toEqual([expect.objectContaining({ outcome: 'completed', trigger: '22:30 on Mon, Tue, Wed, Thu, Fri' })]);
    engine.tick(new Date(2026, 10, 17, 10, 46));
    await settle();
    // 22:30 on both days (1350 is a multiple of 15), not 22:31 or 10:46.
    expect(runs(db, every.id).map((r) => r.trigger)).toEqual(['Every 15 min', 'Every 15 min']);
  });

  it('starts when an action runs, after the action\'s own steps', async () => {
    const { db, rules, actions } = await setup();
    const action = actions.create({ name: 'Good night', steps: [{ kind: 'device', device: SWITCH, values: { state_l3: 'ON' } }] });
    const rule = rules.create({ name: 'after good night', enabled: true, when: [{ type: 'action', action: action.id }], then: [toggle1] });
    expect((await actions.run(action.id)).ok).toBe(true);
    await until(() => runs(db, rule.id)[0]?.outcome === 'completed');
    expect(runs(db, rule.id)[0]!.trigger).toBe('Action "Good night" ran');
    expect(state('state_l3')).toBe('ON');
  });

  it('chains rules through named events, and stops a loop at the hop limit', async () => {
    const { db, rules, engine } = await setup();
    const a = rules.create({ name: 'A', enabled: true, when: [button1], then: [{ type: 'event', name: 'evening started' }] });
    const b = rules.create({ name: 'B', enabled: true, when: [{ type: 'event', name: 'evening started' }], then: [toggle1] });
    await press('1_single');
    await until(() => runs(db, b.id)[0]?.outcome === 'completed');
    expect(runs(db, a.id)[0]!.outcome).toBe('completed');

    const ping = rules.create({ name: 'ping', enabled: true, when: [{ type: 'event', name: 'ping' }], then: [{ type: 'event', name: 'pong' }] });
    const pong = rules.create({ name: 'pong', enabled: true, when: [{ type: 'event', name: 'pong' }], then: [{ type: 'event', name: 'ping' }] });
    engine.sendEvent('ping', 0);
    await until(() => [...runs(db, ping.id), ...runs(db, pong.id)].some((r) => r.outcome === 'stopped'));
    const all = [...runs(db, ping.id), ...runs(db, pong.id)];
    expect(all.filter((r) => r.outcome === 'completed')).toHaveLength(HOP_LIMIT + 1);
    expect(all.find((r) => r.outcome === 'stopped')!.reason).toMatch(/start each other/);
  });

  it('skips the steps when conditions are not met, naming the condition and the device state', async () => {
    const { db, rules, engine } = await setup();
    await bridge!.command(SWITCH, { state_l1: 'ON' });
    const all = rules.create({
      name: 'only when off',
      enabled: true,
      when: [button1],
      if: { mode: 'all', conditions: [{ type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'OFF' }] },
      then: [{ type: 'device', device: SWITCH, values: { state_l2: 'ON' } }],
    });
    const any = rules.create({
      name: 'any of',
      enabled: true,
      when: [{ ...button1, button: 2 }],
      if: {
        mode: 'any',
        conditions: [
          { type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'OFF' },
          { type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'ON' },
        ],
      },
      then: [{ type: 'device', device: SWITCH, values: { state_l3: 'ON' } }],
    });
    await press('1_single');
    await press('2_single');
    await until(() => runs(db, all.id)[0]?.outcome === 'skipped' && runs(db, any.id)[0]?.outcome === 'completed');
    const skipped = engine.history(all.id)[0]!;
    expect(skipped.reason).toBe('Condition not met: biurko robocze state_l1 is OFF');
    expect(skipped.conditions).toEqual([{ condition: 'biurko robocze state_l1 is OFF', met: false, actual: 'ON' }]);
    expect(skipped.steps[0]).toMatchObject({ status: 'not run' });
    expect(state('state_l2')).toBeUndefined();
    expect(state('state_l3')).toBe('ON');
  });

  it('skips a step whose "only if" is not met and carries on; a failed step stops the run', async () => {
    const { db, rules, engine } = await setup();
    await bridge!.command(SWITCH, { state_l1: 'OFF' });
    const rule = rules.create({
      name: 'steps',
      enabled: true,
      when: [button1],
      then: [
        { type: 'device', device: SWITCH, values: { state_l2: 'ON' } },
        { type: 'device', device: SWITCH, values: { state_l1: 'OFF' }, onlyIf: { type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'ON' } },
        { type: 'device', device: SWITCH, values: { state_l3: 'ON' } },
      ],
    });
    await press('1_single');
    await until(() => runs(db, rule.id)[0]?.outcome === 'completed');
    expect(engine.history(rule.id)[0]!.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'done']);
    expect(engine.history(rule.id)[0]!.steps[1]!.reason).toBe('Only if biurko robocze state_l1 is ON (it is OFF)');

    sim!.setOffline('biurko robocze', true);
    await press('1_single');
    await until(() => runs(db, rule.id)[1]?.outcome === 'failed', 15000);
    const failed = engine.history(rule.id)[0]!;
    expect(failed.reason).toBe('Step 1 failed: The device did not confirm the change');
    expect(failed.steps.map((s) => s.status)).toEqual(['failed', 'not run', 'not run']);
  }, 25000);

  it('ignores and records a second event during a wait, and records an interrupted run at stop and restart', async () => {
    const { db, rules, engine } = await setup();
    const rule = rules.create({ name: 'wait', enabled: true, when: [button1], then: [{ type: 'wait', seconds: 300 }, toggle1] });
    await press('1_single');
    await until(() => engine.isRunning(rule.id));
    await press('1_single');
    await until(() => runs(db, rule.id).length === 2);
    expect(runs(db, rule.id)[1]).toMatchObject({ outcome: 'ignored', reason: 'The rule was still running from an earlier event' });
    engine.stop();
    await until(() => runs(db, rule.id)[0]!.outcome === 'interrupted');
    expect(engine.history(rule.id).at(-1)!.steps.map((s) => s.status)).toEqual(['interrupted', 'interrupted']);
    expect(state('state_l1')).toBeUndefined();

    // A run left as running by a crash is marked interrupted at the next start.
    db.prepare("INSERT INTO rule_runs (rule_id, started_at, trigger_text, outcome) VALUES (?, '2026-11-19T00:00:00Z', 'x', 'running')").run(rule.id);
    const again = new RuleEngine(db, rules, { minuteTimer: false });
    again.start();
    again.stop();
    expect(runs(db, rule.id).at(-1)).toMatchObject({ outcome: 'interrupted', reason: 'The hub restarted during this run' });
  });

  it('runs the steps on Test, marked as a test, and can run them even when conditions are not met', async () => {
    const { db, rules, engine } = await setup();
    await bridge!.command(SWITCH, { state_l1: 'ON' });
    const rule = rules.create({
      name: 'test me',
      enabled: false,
      when: [button1],
      if: { mode: 'all', conditions: [{ type: 'state', device: SWITCH, property: 'state_l1', op: 'eq', value: 'OFF' }] },
      then: [{ type: 'device', device: SWITCH, values: { state_l2: 'ON' } }],
    });
    expect(await engine.test(rule.id)).toMatchObject({ test: true, outcome: 'skipped' });
    const forced = await engine.test(rule.id, true);
    expect(forced).toMatchObject({ test: true, outcome: 'completed', reason: 'Conditions not met; steps run anyway as a test' });
    expect(state('state_l2')).toBe('ON');
    expect(runs(db, rule.id).map((r) => r.test)).toEqual([1, 1]);
  });

  it('prunes old runs', async () => {
    const { db, rules } = await setup();
    const rule = rules.create({ name: 'many', enabled: true, when: [button1], then: [{ type: 'event', name: 'x' }] });
    const insert = db.prepare("INSERT INTO rule_runs (rule_id, started_at, trigger_text, outcome) VALUES (?, '2026-01-01T00:00:00Z', 'old', 'completed')");
    for (let i = 0; i < KEEP_RUNS + 20; i++) insert.run(rule.id);
    await press('1_single');
    await until(() => runs(db, rule.id).at(-1)?.trigger === 'Wireless Switch button 1 single_click' && runs(db, rule.id).at(-1)?.outcome === 'completed');
    expect(runs(db, rule.id)).toHaveLength(KEEP_RUNS);
  });
});

describe('rules API', () => {
  it('needs a session, and offers choices built from the devices', async () => {
    const { db, rules, engine } = await setup();
    const app = buildInternalServer({ db, version: 'test', zigbee: bridge, rules, engine });
    expect((await app.inject({ method: 'GET', url: '/api/rules' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/rule-choices' })).statusCode).toBe(401);
    const headers = { cookie: await signIn(app) };
    const created = await app.inject({ method: 'POST', url: '/api/rules', headers, payload: { name: 'desk', enabled: true, when: [button1], then: [toggle1] } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect((await app.inject({ method: 'POST', url: '/api/rules', headers, payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/rules', headers })).json()[0]).toMatchObject({ name: 'desk', enabled: true, running: false, lastRun: null });
    const test = await app.inject({ method: 'POST', url: `/api/rules/${id}/test`, headers, payload: {} });
    expect(test.json()).toMatchObject({ outcome: 'completed', test: true });
    expect((await app.inject({ method: 'GET', url: `/api/rules/${id}/runs`, headers })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/rules/${id}/enabled`, headers, payload: { enabled: false } })).json()).toMatchObject({ enabled: false });
    const choices = (await app.inject({ method: 'GET', url: '/api/rule-choices', headers })).json();
    const remote = choices.devices.find((d: { ieee: string }) => d.ieee === REMOTE);
    expect(remote.events).toContainEqual({ raw: '1_single', button: 1, press: 'single_click' });
    const desk = choices.devices.find((d: { ieee: string }) => d.ieee === SWITCH);
    expect(desk.properties.map((p: { property: string }) => p.property)).toContain('state_l1');
    expect((await app.inject({ method: 'DELETE', url: `/api/rules/${id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/rules/${id}`, headers })).statusCode).toBe(404);
    await app.close();
  });
});
