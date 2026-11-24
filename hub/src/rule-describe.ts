import type { Db } from './db.js';
import { Actions } from './actions.js';
import { Devices } from './devices.js';
import { LightGroups } from './groups.js';
import { DAY_NAMES } from './rule-match.js';
import type { Condition, RuleStep, Trigger } from './rules.js';

// Rule parts in words, with the names the owner gave devices, channels, groups and actions: for run history and for
// "only if" reasons.
const forText = (minutes?: number) => (minutes === undefined ? '' : ` for at least ${minutes} min`);

export class RuleDescriber {
  constructor(private readonly db: Db) {}

  private actionName(id: number): string | number {
    return new Actions(this.db).get(id)?.name ?? id;
  }

  private deviceName(ieee: string): string {
    return new Devices(this.db).get(ieee)?.name ?? ieee;
  }

  private propertyName(ieee: string, property: string): string {
    const endpoint = /^state_(.+)$/.exec(property)?.[1];
    if (!endpoint) return property;
    const label = new Devices(this.db).label(ieee, endpoint);
    return label ? `${label} (${endpoint})` : property;
  }

  describeTrigger(t: Trigger): string {
    switch (t.type) {
      case 'button':
        return `${this.deviceName(t.device)} ${t.raw ?? `button ${t.button} ${t.press}`}`;
      case 'state': {
        const what = `${this.deviceName(t.device)} ${this.propertyName(t.device, t.property)}`;
        if (t.forMinutes !== undefined) {
          const state = t.to !== undefined ? `stayed ${String(t.to)}` : t.above !== undefined ? `stayed above ${t.above}` : `stayed below ${t.below}`;
          return `${what} ${state} for ${t.forMinutes} min`;
        }
        if (t.to !== undefined) return `${what} became ${String(t.to)}`;
        if (t.above !== undefined) return `${what} rose above ${t.above}`;
        if (t.below !== undefined) return `${what} fell below ${t.below}`;
        return `${what} changed`;
      }
      case 'time':
        return `${t.at}${t.random ? ` ±${t.random} min` : ''} on ${t.days.map((d) => DAY_NAMES[d]).join(', ')}`;
      case 'sun': {
        const when = t.offset === 0 ? t.event : `${Math.abs(t.offset)} min ${t.offset < 0 ? 'before' : 'after'} ${t.event}`;
        return `${when[0]!.toUpperCase()}${when.slice(1)}${t.random ? ` ±${t.random} min` : ''} on ${t.days.map((d) => DAY_NAMES[d]).join(', ')}`;
      }
      case 'every':
        return `Every ${t.minutes} min`;
      case 'action': {
        return `Action "${this.actionName(t.action)}" ran`;
      }
      case 'event':
        return `Event "${t.name}"`;
    }
  }

  describeCondition(c: Condition): string {
    if (c.type === 'state') {
      if (c.op === 'between') {
        const [lo, hi] = c.value as [number, number];
        return `${this.deviceName(c.device)} ${this.propertyName(c.device, c.property)} is between ${lo} and ${hi}${forText(c.forMinutes)}`;
      }
      const op = { eq: 'is', ne: 'is not', gt: 'is above', lt: 'is below' }[c.op];
      return `${this.deviceName(c.device)} ${this.propertyName(c.device, c.property)} ${op} ${String(c.value)}${forText(c.forMinutes)}`;
    }
    if (c.type === 'time') return `time is between ${c.from} and ${c.to}`;
    if (c.type === 'sun') return c.is === 'dark' ? 'it is dark (sunset to sunrise)' : 'it is light (sunrise to sunset)';
    if (c.type === 'group') {
      const name = new LightGroups(this.db).summary(c.group)?.name ?? `group ${c.group}`;
      return `light group ${name} is ${{ off: 'off (all lights)', partly: 'partly on (some lights)', on: 'on (all lights)' }[c.is]}`;
    }
    return `day is ${c.days.map((d) => DAY_NAMES[d]).join(', ')}`;
  }

  describeStep(s: RuleStep): string {
    const values = (v: Record<string, unknown>, ieee?: string) =>
      Object.entries(v)
        .map(([k, x]) => `${ieee ? this.propertyName(ieee, k) : k} ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
        .join(', ');
    switch (s.type) {
      case 'device':
        return `Set ${this.deviceName(s.device)}: ${values(s.values, s.device)}`;
      case 'group': {
        return `Set group ${new LightGroups(this.db).summary(s.group)?.name ?? s.group}: ${values(s.values)}`;
      }
      case 'wait':
        return `Wait ${s.seconds} s`;
      case 'action': {
        return `Run action ${this.actionName(s.action)}`;
      }
      case 'event':
        return `Send event "${s.name}"`;
      case 'notify':
        return `Notify (${s.level}): "${s.text}"`;
      case 'later':
        return `After ${s.minutes} min (restarts if run again): ${this.describeStep(s.step)}`;
    }
  }
}
