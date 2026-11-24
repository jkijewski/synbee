import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { Energy } from '../src/energy.js';
import { flattenExposes } from '../src/exposes.js';
import { History } from '../src/history.js';
import { Notifications, MAX_PER_HOUR } from '../src/notifications.js';
import { watchDevices } from '../src/device-watchers.js';
import { RuleEngine } from '../src/rule-engine.js';
import { Rules } from '../src/rules.js';
import { sampleSensors, sampleSensorStates } from '../src/sim/sample-devices.js';
import { FakeDevices } from './fake-devices.js';

// Phase 3 (0014): reading history, energy totals, notifications and "for N minutes" rules.
const DOOR = '0x00158d0000000101';
const LEAK = '0x00158d0000000102';
const MOTION = '0x00158d0000000103';
const T0 = new Date(2026, 10, 20, 8, 0).getTime();
const MIN = 60_000;
const propsOf = (ieee: string) => flattenExposes(sampleSensors.find((d) => d.ieee_address === ieee)!.definition!.exposes);

afterEach(() => vi.useRealTimers());

describe('reading history', () => {
  it('keeps raw readings, rolls them up, prunes by age and size, and knows when values began', () => {
    const db = openDatabase(':memory:');
    const h = new History(db);
    const props = [...propsOf(DOOR), { property: 'temperature', name: 'temperature', type: 'numeric', readable: true, writable: false }];
    for (let i = 0; i < 12; i++) h.record(DOOR, props, { temperature: 20 + i, contact: i < 6 }, ['temperature', 'contact'], T0 + i * MIN);
    expect(h.series(DOOR, 'temperature', '24h', T0 + 12 * MIN).map((p) => p.value)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    expect(h.series(DOOR, 'contact', '24h', T0 + 12 * MIN).map((p) => p.value)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    // Settings (linkquality, config) aren't kept.
    expect(h.properties(DOOR).sort()).toEqual(['battery', 'contact', 'temperature'].filter((p) => p !== 'battery'));
    expect(h.since(DOOR, 'contact')).toEqual({ value: false, since: T0 + 6 * MIN });
    // 5-minute buckets: 8:00 (20–24), 8:05 (25–29), 8:10 (30, 31).
    expect(h.series(DOOR, 'temperature', '7d', T0 + 12 * MIN).map((p) => p.value)).toEqual([22, 27, 30.5]);
    h.maintain(T0 + 15 * MIN);
    expect(h.series(DOOR, 'temperature', '30d', T0 + 15 * MIN).map((p) => p.value)).toEqual([25.5]);
    h.saveSettings({ rawDays: 1 });
    h.maintain(T0 + 2 * 864e5);
    expect(h.series(DOOR, 'temperature', '24h', T0 + 2 * 864e5)).toEqual([]);
    expect(h.series(DOOR, 'temperature', '7d', T0 + 2 * 864e5).map((p) => p.value)).toEqual([22, 27, 30.5]);
    expect(() => h.saveSettings({ rawDays: 0 })).toThrow(/Raw days/);
  });

  it('tells whether a value held for the last N minutes', () => {
    const h = new History(openDatabase(':memory:'));
    const t = { property: 'temperature', name: 'temperature', type: 'numeric', readable: true, writable: false };
    h.record(DOOR, [t], { temperature: 26 }, ['temperature'], T0);
    h.record(DOOR, [t], { temperature: 27 }, ['temperature'], T0 + 10 * MIN);
    const above25 = (v: unknown) => typeof v === 'number' && v > 25;
    expect(h.heldFor(DOOR, 'temperature', 15, above25, (n) => n, T0 + 16 * MIN)).toBe(true);
    expect(h.heldFor(DOOR, 'temperature', 15, above25, (n) => n, T0 + 14 * MIN)).toBe(false);
    h.record(DOOR, [t], { temperature: 24 }, ['temperature'], T0 + 20 * MIN);
    h.record(DOOR, [t], { temperature: 26 }, ['temperature'], T0 + 21 * MIN);
    expect(h.heldFor(DOOR, 'temperature', 15, above25, (n) => n, T0 + 30 * MIN)).toBe(false);
  });
});

describe('energy totals', () => {
  it('adds counter increases per day, and ignores restarts, replacements and jumps', () => {
    const e = new Energy(openDatabase(':memory:'));
    const PLUG = '0xaa00000000000001';
    expect(e.record(PLUG, 100, T0)).toBe(0); // first reading only sets the base
    expect(e.record(PLUG, 100.5, T0 + 60 * MIN)).toBeCloseTo(0.5);
    expect(e.record(PLUG, 0.2, T0 + 120 * MIN)).toBeCloseTo(0.2); // counter restarted after a power cut
    expect(e.record(PLUG, 0.4, T0 + 180 * MIN)).toBeCloseTo(0.2);
    expect(e.record(PLUG, 350, T0 + 240 * MIN)).toBe(0); // another device's total under the same address
    expect(e.record(PLUG, 351, T0 + 864e5)).toBeCloseTo(1); // next day
    expect(e.totals(PLUG, T0 + 864e5)).toEqual({ today: 1, month: 1.9, days: [{ day: '2026-11-20', kwh: 0.9 }, { day: '2026-11-21', kwh: 1 }] });
    expect(e.totals(undefined, T0 + 864e5).month).toBe(1.9);
  });
});

describe('notifications', () => {
  it('folds repeats, limits floods but not alarms, counts unread and hands new ones to channels', async () => {
    let now = T0;
    const n = new Notifications(openDatabase(':memory:'), () => now);
    const delivered: string[] = [];
    n.addChannel({ name: 'test', deliver: (x) => void delivered.push(x.title) });
    n.notify({ level: 'info', title: 'Door open', dedupeKey: 'r1' });
    now += 60_000;
    expect(n.notify({ level: 'info', title: 'Door open', dedupeKey: 'r1' })).toMatchObject({ repeats: 1 });
    expect(n.list()).toHaveLength(1);
    for (let i = 0; i < MAX_PER_HOUR; i++) n.notify({ level: 'info', title: `n${i}` });
    expect(n.notify({ level: 'warning', title: 'one too many' })).toBeNull();
    expect(n.notify({ level: 'alarm', title: 'Leak' })).not.toBeNull();
    expect(n.unread()).toEqual({ count: MAX_PER_HOUR + 1, alarm: true });
    n.markAllRead();
    expect(n.unread()).toEqual({ count: 0, alarm: false });
    await new Promise((r) => setImmediate(r));
    expect(delivered[0]).toBe('Door open');
    expect(delivered).toContain('Leak');
  });
});

describe('device watchers', () => {
  it('records history and energy and notifies when an alarm starts, once', () => {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const devices = new Devices(db);
    devices.addPaired(LEAK, 'bathroom_leak');
    const history = new History(db);
    const notifications = new Notifications(db);
    const stop = watchDevices(fake, { devices, history, energy: new Energy(db), notifications });
    fake.report(LEAK, sampleSensorStates.bathroom_leak!); // first report after a start: not a new alarm
    expect(notifications.list()).toHaveLength(0);
    fake.report(LEAK, { ...sampleSensorStates.bathroom_leak!, water_leak: false });
    fake.report(LEAK, { ...sampleSensorStates.bathroom_leak!, water_leak: true });
    expect(notifications.list().map((x) => [x.level, x.title])).toEqual([['alarm', 'bathroom_leak: Water leak Wet']]);
    expect(history.properties(LEAK)).toContain('water_leak');
    notifications.saveSettings({ autoAlarms: false });
    fake.report(LEAK, { ...sampleSensorStates.bathroom_leak!, water_leak: false });
    fake.report(LEAK, { ...sampleSensorStates.bathroom_leak!, water_leak: true });
    expect(notifications.list()).toHaveLength(1);
    stop();
  });
});

describe('"for N minutes" rules', () => {
  function setup(db = openDatabase(':memory:'), fake = new FakeDevices()) {
    const devices = new Devices(db);
    for (const d of fake.knownDevices()) if (!devices.exists(d.ieee_address)) devices.addPaired(d.ieee_address, d.friendly_name);
    const history = new History(db);
    const notifications = new Notifications(db, () => Date.now());
    const stop = watchDevices(fake, { devices, history, energy: new Energy(db), notifications });
    const rules = new Rules(db, fake);
    const engine = new RuleEngine(db, rules, { zigbee: fake, history, notifications, minuteTimer: false });
    engine.start();
    return { db, fake, rules, engine, notifications, stop };
  }

  it('runs once the door has stayed open 5 minutes, not if it closes sooner, and survives a hub restart', async () => {
    vi.useFakeTimers({ now: T0 });
    const s = setup();
    const rule = s.rules.create({
      name: 'Door open 5 min',
      enabled: true,
      when: [{ type: 'state', device: DOOR, property: 'contact', to: false, forMinutes: 5 }],
      then: [{ type: 'notify', text: 'The front door is open', level: 'warning' }],
    });
    s.fake.report(DOOR, { contact: true });
    s.fake.report(DOOR, { contact: false });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    s.fake.report(DOOR, { contact: true }); // closed in time: cancelled
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(s.engine.history(rule.id)).toHaveLength(0);
    s.fake.report(DOOR, { contact: false });
    expect(s.engine.armed(rule.id)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    // The hub restarts during the wait: the stored timer is re-armed with the time left.
    s.engine.stop();
    s.stop();
    const again = setup(s.db, s.fake);
    await vi.advanceTimersByTimeAsync(3 * MIN + 100);
    expect(again.engine.history(rule.id)[0]).toMatchObject({ outcome: 'completed', trigger: 'front_door contact stayed false for 5 min' });
    expect(again.notifications.list()[0]).toMatchObject({ level: 'warning', title: 'The front door is open', ruleId: rule.id });
    // Still open: it doesn't fire again until the door closes and opens again.
    s.fake.report(DOOR, { contact: false, battery: 80 });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(again.engine.history(rule.id)).toHaveLength(1);
    again.engine.stop();
    again.stop();
  });

  it('checks "for at least N minutes" conditions against history', async () => {
    vi.useFakeTimers({ now: T0 });
    const s = setup();
    s.fake.report(MOTION, { occupancy: true });
    s.fake.report(MOTION, { occupancy: false });
    const rule = s.rules.create({
      name: 'Door opens, nobody moved for 10 min',
      enabled: true,
      when: [{ type: 'state', device: DOOR, property: 'contact', to: false }],
      if: { mode: 'all', conditions: [{ type: 'state', device: MOTION, property: 'occupancy', op: 'eq', value: false, forMinutes: 10 }] },
      then: [{ type: 'notify', text: 'Door opened in an empty house', level: 'alarm' }],
    });
    s.fake.report(DOOR, { contact: true });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    s.fake.report(DOOR, { contact: false });
    await vi.advanceTimersByTimeAsync(10);
    expect(s.engine.history(rule.id)[0]).toMatchObject({ outcome: 'skipped' });
    await vi.advanceTimersByTimeAsync(6 * MIN);
    s.fake.report(DOOR, { contact: true });
    s.fake.report(DOOR, { contact: false });
    await vi.advanceTimersByTimeAsync(10);
    expect(s.engine.history(rule.id)[0]).toMatchObject({ outcome: 'completed' });
    s.engine.stop();
    s.stop();
  });

  it('validates durations and notify steps', () => {
    const rules = new Rules(openDatabase(':memory:'));
    expect(() => rules.create({ name: 'x', when: [{ type: 'state', device: DOOR, property: 'contact', forMinutes: 5 }], then: [{ type: 'wait', seconds: 1 }] })).toThrow(/needs a value or a threshold/);
    expect(() => rules.create({ name: 'x', when: [{ type: 'state', device: DOOR, property: 'contact', to: false, forMinutes: 0 }], then: [{ type: 'wait', seconds: 1 }] })).toThrow(/minutes/);
    expect(() => rules.create({ name: 'x', when: [{ type: 'event', name: 'a' }], then: [{ type: 'notify', text: '' }] })).toThrow(/notification text/);
  });
});
