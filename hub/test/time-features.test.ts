import { describe, expect, it, vi, afterEach } from 'vitest';
import { Actions } from '../src/actions.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { LightGroups } from '../src/groups.js';
import { RuleEngine } from '../src/rule-engine.js';
import { evaluateCondition, scheduledAt, timeTrigger } from '../src/rule-match.js';
import { parseRule, Rules, type Rule } from '../src/rules.js';
import { LOCATION_KEY, Settings } from '../src/settings.js';
import { dailyOffset, isDark, sunTime, validLocation } from '../src/sun.js';
import { FakeDevices } from './fake-devices.js';

// Sunrise and sunset, random offsets and timer steps (0010).
const GDANSK = { latitude: 54.35, longitude: 18.65 };
const BULB = '0x60a423fffe000001';
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

afterEach(() => vi.useRealTimers());

describe('sun', () => {
  it('computes sunrise and sunset close to the almanac', () => {
    // Gdańsk, 21 December: sunrise about 08:03 UTC+1 (07:03 UTC), sunset about 15:25 (14:25 UTC).
    const day = new Date(2026, 11, 21, 12);
    const rise = sunTime('sunrise', day, GDANSK)!;
    const set = sunTime('sunset', day, GDANSK)!;
    expect(Math.abs(rise.getUTCHours() * 60 + rise.getUTCMinutes() - (7 * 60 + 3))).toBeLessThanOrEqual(5);
    expect(Math.abs(set.getUTCHours() * 60 + set.getUTCMinutes() - (14 * 60 + 25))).toBeLessThanOrEqual(5);
    expect(isDark(new Date(set.getTime() + 60_000), GDANSK)).toBe(true);
    expect(isDark(new Date(rise.getTime() + 60_000), GDANSK)).toBe(false);
  });

  it('knows days without a sunset', () => {
    expect(sunTime('sunset', new Date(2026, 5, 21, 12), { latitude: 78, longitude: 15 })).toBeNull();
  });

  it('validates locations and keeps random offsets within their spread, the same all day', () => {
    expect(validLocation({ latitude: 54.3521, longitude: 18.6464 })).toEqual({ latitude: 54.352, longitude: 18.646 });
    expect(validLocation({ latitude: 91, longitude: 0 })).toBeNull();
    const day = new Date(2026, 10, 21, 8);
    const a = dailyOffset('1:0', day, 15);
    expect(a).toBe(dailyOffset('1:0', new Date(2026, 10, 21, 20), 15));
    expect(Math.abs(a)).toBeLessThanOrEqual(15);
    const all = new Set(Array.from({ length: 60 }, (_, i) => dailyOffset('1:0', new Date(2026, 0, 1 + i), 15)));
    expect(all.size).toBeGreaterThan(10);
  });
});

describe('time and sun events', () => {
  const rule = (when: unknown[]): Rule => ({ id: 7, name: 'r', enabled: true, draft: false, notes: '', ...parseRule({ name: 'r', when, then: [{ type: 'wait', seconds: 1 }] }) }) as Rule;
  const ALL = [1, 2, 3, 4, 5, 6, 7];

  it('fires 30 minutes before sunset, only with a location', () => {
    const r = rule([{ type: 'sun', event: 'sunset', offset: -30, days: ALL }]);
    const day = new Date(2026, 10, 21, 12);
    const due = scheduledAt(r, 0, day, GDANSK)!;
    expect(due.getTime()).toBe(sunTime('sunset', day, GDANSK)!.getTime() - 30 * 60_000);
    const minute = new Date(due.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), due.getMinutes());
    expect(timeTrigger(r, minute, GDANSK)).toBeDefined();
    expect(timeTrigger(r, new Date(minute.getTime() + 60_000), GDANSK)).toBeUndefined();
    expect(timeTrigger(r, minute, null)).toBeUndefined();
  });

  it('moves a time by its random offset, once a day', () => {
    const r = rule([{ type: 'time', at: '22:00', days: ALL, random: 15 }]);
    const day = new Date(2026, 10, 21, 12);
    const due = scheduledAt(r, 0, day, null)!;
    expect(Math.abs(minutesOfDay(due) - 22 * 60)).toBeLessThanOrEqual(15);
    const fired = Array.from({ length: 24 * 60 }, (_, m) => new Date(2026, 10, 21, 0, m)).filter((t) => timeTrigger(r, t));
    expect(fired.map((t) => minutesOfDay(t))).toEqual([minutesOfDay(due)]);
  });

  it('refuses bad sun events and offsets', () => {
    expect(() => parseRule({ name: 'r', when: [{ type: 'sun', event: 'noon', days: ALL }], then: [] })).toThrow();
    expect(() => parseRule({ name: 'r', when: [{ type: 'sun', event: 'sunset', offset: 500, days: ALL }], then: [] })).toThrow();
    expect(() => parseRule({ name: 'r', when: [{ type: 'time', at: '22:00', days: ALL, random: 90 }], then: [] })).toThrow();
  });

  it('says whether it is dark', () => {
    const day = new Date(2026, 10, 21, 12);
    const night = new Date(sunTime('sunset', day, GDANSK)!.getTime() + 3600_000);
    expect(evaluateCondition({ type: 'sun', is: 'dark' }, () => undefined, night, undefined, GDANSK)).toEqual({ met: true, actual: 'dark' });
    expect(evaluateCondition({ type: 'sun', is: 'light' }, () => undefined, day, undefined, GDANSK)).toEqual({ met: true, actual: 'light' });
    expect(evaluateCondition({ type: 'sun', is: 'dark' }, () => undefined, night, undefined, null).met).toBe(false);
  });
});

describe('timer steps', () => {
  function setup(db = openDatabase(':memory:'), now = { t: Date.now() }) {
    const fake = new FakeDevices();
    const devices = new Devices(db);
    for (const d of fake.knownDevices()) if (!devices.exists(d.ieee_address)) devices.addPaired(d.ieee_address, d.friendly_name);
    const groups = new LightGroups(db, fake);
    const actions = new Actions(db, fake, groups);
    const rules = new Rules(db, fake);
    const engine = new RuleEngine(db, rules, { zigbee: fake, actions, groups, minuteTimer: false, now: () => new Date(now.t) });
    engine.start();
    return { db, fake, rules, engine, now };
  }

  it('switches a light off N minutes after the last time the rule ran, and survives a restart', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { db, fake, rules, engine, now } = setup();
    const rule = rules.create({
      name: 'Light on, auto-off',
      enabled: true,
      when: [{ type: 'event', name: 'go' }],
      then: [
        { type: 'device', device: BULB, values: { state: 'ON' } },
        { type: 'later', minutes: 10, step: { type: 'device', device: BULB, values: { state: 'OFF' } } },
      ],
    });
    engine.sendEvent('go', 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.deviceState(BULB)?.state).toBe('ON');
    expect(engine.timers(rule.id)).toHaveLength(1);
    // Run again 6 minutes later: the countdown starts again.
    now.t += 6 * 60_000;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    engine.sendEvent('go', 0);
    await vi.advanceTimersByTimeAsync(10);
    now.t += 6 * 60_000;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(fake.deviceState(BULB)?.state).toBe('ON');
    // The hub restarts with 4 minutes left: the stored timer is re-armed.
    engine.stop();
    const again = setup(db, now);
    expect(again.engine.timers(rule.id)).toHaveLength(1);
    now.t += 4 * 60_000;
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 10);
    expect(again.fake.commands.at(-1)).toEqual({ target: BULB, values: { state: 'OFF' } });
    expect(again.engine.timers(rule.id)).toHaveLength(0);
    expect(again.engine.history(rule.id, 1)[0]).toMatchObject({ trigger: 'Timer of step 2 ran out', outcome: 'completed' });
  });

  it('can be stopped without running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fake, rules, engine } = setup();
    const rule = rules.create({
      name: 'Auto-off',
      enabled: true,
      when: [{ type: 'event', name: 'go' }],
      then: [{ type: 'later', minutes: 1, step: { type: 'device', device: BULB, values: { state: 'OFF' } } }],
    });
    engine.sendEvent('go', 0);
    await vi.advanceTimersByTimeAsync(10);
    engine.cancelTimer(rule.id, 0);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(fake.commands).toHaveLength(0);
  });

  it('uses the location stored in settings', () => {
    const { db, engine } = setup();
    expect(engine.location()).toBeNull();
    new Settings(db).set(LOCATION_KEY, GDANSK);
    expect(engine.location()).toEqual(GDANSK);
  });
});

describe('light group status', () => {
  it('is off, partly or on from its lights, ignoring lights not heard from', async () => {
    const { groupStatus } = await import('../src/rule-match.js');
    expect(groupStatus([false, false])).toBe('off');
    expect(groupStatus([true, true, undefined])).toBe('on');
    expect(groupStatus([true, false])).toBe('partly');
    expect(groupStatus([undefined])).toBeNull();
  });

  it('decides a rule by the group, not by one light', async () => {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const devices = new Devices(db);
    for (const d of fake.knownDevices()) devices.addPaired(d.ieee_address, d.friendly_name);
    const groups = new LightGroups(db, fake);
    const actions = new Actions(db, fake, groups);
    const rules = new Rules(db, fake);
    const engine = new RuleEngine(db, rules, { zigbee: fake, actions, groups, minuteTimer: false });
    engine.start();
    const [a, b] = ['0x60a423fffe000001', '0x60a423fffe000002'];
    const g = await groups.create({ name: 'bedroom', members: [{ ieee: a }, { ieee: b }] });
    const rule = rules.create({
      name: 'Off if anything is on',
      enabled: true,
      when: [{ type: 'event', name: 'click' }],
      if: { mode: 'any', conditions: [{ type: 'group', group: g.id, is: 'on' }, { type: 'group', group: g.id, is: 'partly' }] },
      then: [{ type: 'group', group: g.id, values: { state: 'OFF' } }],
    });
    fake.report(a, { state: 'OFF' });
    fake.report(b, { state: 'ON' });
    const run = await engine.test(rule.id);
    expect(run.conditions).toEqual([
      { condition: 'light group bedroom is on (all lights)', met: false, actual: 'partly' },
      { condition: 'light group bedroom is partly on (some lights)', met: true, actual: 'partly' },
    ]);
    expect(run.outcome).toBe('completed');
  });
});
