import type { DeviceEvents } from './ports.js';
import type { Condition, Rule, Trigger } from './rules.js';
import { dailyOffset, isDark, sunTime, type Location } from './sun.js';

// Which rule events match what happened, and whether conditions hold (0010). Pure functions of the rule, the event
// and the time, so they are easy to test on their own.

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isoWeekday = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
export const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function buttonTrigger(rule: Rule, e: DeviceEvents['button']): Trigger | undefined {
  return rule.when.find(
    (w) => w.type === 'button' && w.device === e.ieee && (w.raw !== undefined ? w.raw === e.raw : w.button === e.button && w.press === e.press),
  );
}

export function stateTrigger(rule: Rule, e: DeviceEvents['state']): Trigger | undefined {
  return rule.when.find((w) => {
    // "For N minutes" events wait for their timer instead (rule-durations.ts).
    if (w.type !== 'state' || w.forMinutes !== undefined || w.device !== e.ieee || !e.changed.includes(w.property)) return false;
    // The first value seen after a start isn't a change; Zigbee2MQTT replays states when it starts.
    if (!(w.property in e.previous)) return false;
    const before = e.previous[w.property];
    const after = e.state[w.property];
    if (w.to !== undefined && !(after === w.to && before !== w.to)) return false;
    if (w.above !== undefined && !(typeof after === 'number' && after > w.above && !(typeof before === 'number' && before > w.above))) return false;
    if (w.below !== undefined && !(typeof after === 'number' && after < w.below && !(typeof before === 'number' && before < w.below))) return false;
    return true;
  });
}

/**
 * When a time or sun event is due on the day of `day`, or null (no location for sun events, or no sunrise or sunset
 * that day). A random spread moves it by the same number of minutes all day, different each day and rule.
 */
export function scheduledAt(rule: Rule, index: number, day: Date, location: Location | null): Date | null {
  const w = rule.when[index];
  let base: Date | null = null;
  if (w?.type === 'time') {
    const [h, m] = w.at.split(':').map(Number) as [number, number];
    base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  } else if (w?.type === 'sun') {
    const sun = location ? sunTime(w.event, day, location) : null;
    base = sun ? new Date(sun.getTime() + w.offset * 60_000) : null;
  }
  if (!base || (w?.type !== 'time' && w?.type !== 'sun')) return null;
  const shift = w.random ? dailyOffset(`${rule.id}:${index}`, day, w.random) : 0;
  return new Date(base.getTime() + shift * 60_000);
}

/** The time event that fires in the given minute, in the NAS's time zone. */
export function timeTrigger(rule: Rule, at: Date, location: Location | null = null): Trigger | undefined {
  const time = hhmm(at);
  const day = isoWeekday(at);
  const minuteOfDay = at.getHours() * 60 + at.getMinutes();
  return rule.when.find((w, i) => {
    if (w.type === 'every') return minuteOfDay % w.minutes === 0;
    if ((w.type === 'time' || w.type === 'sun') && w.days.includes(day as never)) {
      const due = scheduledAt(rule, i, at, location);
      return due !== null && hhmm(due) === time && due.getDate() === at.getDate();
    }
    return false;
  });
}

/** Whether a "for N minutes" event's state holds for this value: equal to `to`, or above or below the threshold. */
export function durationHolds(w: Extract<Trigger, { type: 'state' }>, value: unknown): boolean {
  if (value === undefined) return false;
  if (w.to !== undefined) return value === w.to;
  if (typeof value !== 'number') return false;
  if (w.above !== undefined) return value > w.above;
  if (w.below !== undefined) return value < w.below;
  return false;
}

/** Whether a numeric condition holds for one value (gt, lt, between, eq, ne); for "held for N minutes" checks. */
export function conditionHoldsFor(c: Extract<Condition, { type: 'state' }>, actual: unknown): boolean {
  if (c.op === 'between') {
    const [lo, hi] = c.value as [number, number];
    return typeof actual === 'number' && actual >= lo && actual <= hi;
  }
  if (c.op === 'eq') return actual === c.value;
  if (c.op === 'ne') return actual !== c.value;
  if (typeof actual !== 'number' || typeof c.value !== 'number') return false;
  return c.op === 'gt' ? actual > c.value : actual < c.value;
}

/** Whether a condition holds, with the value it was decided on. */
export function evaluateCondition(
  c: Condition,
  deviceValue: (ieee: string, property: string) => unknown,
  now: Date,
  /** For "for at least N minutes": whether the condition has held all of the last `minutes` (from history). */
  heldFor?: (c: Extract<Condition, { type: 'state' }>, minutes: number) => boolean,
  /** The home's location, for "it is dark". */
  location: Location | null = null,
  /** Whether each light of a group is on (true), off (false) or unknown (undefined). */
  groupLights?: (group: number) => Array<boolean | undefined>,
): { met: boolean; actual?: unknown } {
  if (c.type === 'state') {
    const actual = deviceValue(c.device, c.property);
    let met = conditionHoldsFor(c, actual);
    if (met && c.forMinutes !== undefined) met = heldFor?.(c, c.forMinutes) ?? false;
    return { met, actual: actual === undefined ? 'unknown' : actual };
  }
  if (c.type === 'time') {
    const t = hhmm(now);
    return { met: c.from < c.to ? t >= c.from && t < c.to : t >= c.from || t < c.to, actual: t };
  }
  if (c.type === 'group') {
    const status = groupStatus(groupLights?.(c.group) ?? []);
    return { met: status === c.is, actual: status ?? 'unknown' };
  }
  if (c.type === 'sun') {
    if (!location) return { met: false, actual: 'no home location set' };
    const dark = isDark(now, location);
    return { met: c.is === 'dark' ? dark : !dark, actual: dark ? 'dark' : 'light' };
  }
  const day = isoWeekday(now);
  return { met: c.days.includes(day as never), actual: DAY_NAMES[day] };
}

/** A light group's status from its lights: off (all off), on (all on) or partly; null when no light is known. */
export function groupStatus(lights: Array<boolean | undefined>): 'off' | 'partly' | 'on' | null {
  const known = lights.filter((x): x is boolean => x !== undefined);
  if (known.length === 0) return null;
  if (known.every((x) => !x)) return 'off';
  if (known.every((x) => x)) return 'on';
  return 'partly';
}
