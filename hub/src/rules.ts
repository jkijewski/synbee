import type { Db } from './db.js';
import { Devices } from './devices.js';
import { flattenExposes } from './exposes.js';
import { checkValues } from './features/index.js';
import { checkValue } from './exposes.js';
import { buttonEvents, type PressType } from './buttons.js';
import { Actions, stepReadiness, type Readiness } from './actions.js';
import { LightGroups } from './groups.js';
import type { DeviceControl } from './ports.js';
import { LOCATION_KEY, Settings } from './settings.js';
import { validLocation } from './sun.js';

// WHEN / IF / THEN rules (0010): the model, validation against device capabilities, and storage.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: Monday 1 … Sunday 7

export type Trigger =
  /** A button press, by normalised button and press type, or by the raw value for remotes without a mapping. */
  | { type: 'button'; device: string; button?: number; press?: PressType; raw?: string }
  /** A device property changing: to a value, above or below a threshold, or to anything. */
  /** With `forMinutes`, the rule starts only once the device has stayed that way for that long (0014). */
  | { type: 'state'; device: string; property: string; to?: unknown; above?: number; below?: number; forMinutes?: number }
  /** With `random`, each day at a time up to that many minutes earlier or later, the same all day. */
  | { type: 'time'; at: string; days: Weekday[]; random?: number }
  /** Sunrise or sunset at the home's location, moved by `offset` minutes (negative is before). */
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offset: number; days: Weekday[]; random?: number }
  | { type: 'every'; minutes: number }
  | { type: 'action'; action: number }
  | { type: 'event'; name: string };

export type Comparator = 'eq' | 'ne' | 'gt' | 'lt' | 'between';

export type Condition =
  /** With `forMinutes`, the value must also have held for at least that long (0014). */
  | { type: 'state'; device: string; property: string; op: Comparator; value: unknown; forMinutes?: number }
  | { type: 'time'; from: string; to: string }
  | { type: 'days'; days: Weekday[] }
  /** Dark is from sunset to sunrise at the home's location. */
  | { type: 'sun'; is: 'dark' | 'light' }
  /** A light group's lights: all off, some on and some off ("partly"), or all on. */
  | { type: 'group'; group: number; is: GroupStatus };

export type GroupStatus = 'off' | 'partly' | 'on';

/** What a timer does when it runs out: set a device or a light group. */
export type TimedStep = { type: 'device'; device: string; values: Record<string, unknown> } | { type: 'group'; group: number; values: Record<string, unknown> };

export type RuleStep = (
  | { type: 'device'; device: string; values: Record<string, unknown> }
  | { type: 'group'; group: number; values: Record<string, unknown> }
  /** A timer: after `minutes`, do `step`. Running the step again starts the countdown again (auto-off). */
  | { type: 'later'; minutes: number; step: TimedStep }
  | { type: 'wait'; seconds: number }
  | { type: 'action'; action: number }
  | { type: 'event'; name: string }
  | { type: 'notify'; text: string; level: 'info' | 'warning' | 'alarm' }
) & {
  onlyIf?: Condition;
  /** When this step runs (its "only if" holds), the rule ends after it. Lets "off if on, else full" be two steps. */
  stop?: boolean;
};

export interface RuleDefinition {
  when: Trigger[];
  if: { mode: 'all' | 'any'; conditions: Condition[] };
  then: RuleStep[];
}

export interface Rule extends RuleDefinition {
  id: number;
  name: string;
  enabled: boolean;
  /** Imported and not yet checked. A draft can't be enabled until it is saved as a normal rule. */
  draft: boolean;
  notes: string;
}

export interface RuleView extends Rule {
  /** Problems found against the devices as they are now, such as a device that disappeared. */
  warnings: string[];
  readiness: Readiness;
}

export class RuleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_EVENTS = 10;
export const MAX_CONDITIONS = 10;
export const MAX_STEPS = 20;
export const MAX_WAIT_SECONDS = 24 * 3600;
const IEEE = /^0x[0-9a-f]{16}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_NAME = /^[\p{L}\p{N} _.-]{1,60}$/u;
const PRESSES = ['single_click', 'double_click', 'long_press'];

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RuleError(`${what}: expected an object`);
  return v as Record<string, unknown>;
};
const device = (v: unknown, what: string) => {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (!IEEE.test(s)) throw new RuleError(`${what}: choose a device`);
  return s;
};
const intIn = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new RuleError(`${what} must be a whole number from ${min} to ${max}`);
  return v;
};
const days = (v: unknown, what: string): Weekday[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 7) throw new RuleError(`${what}: choose at least one weekday`);
  const out = [...new Set(v.map((d) => intIn(d, 1, 7, `${what}: weekday`)))].sort();
  return out as Weekday[];
};
const property = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_]{1,60}$/.test(v)) throw new RuleError(`${what}: choose a property`);
  return v;
};
const scalar = (v: unknown, what: string) => {
  if (v === null || !['string', 'number', 'boolean'].includes(typeof v)) throw new RuleError(`${what}: choose a value`);
  if (typeof v === 'string' && v.length > 100) throw new RuleError(`${what}: value too long`);
  return v;
};
const values = (v: unknown, what: string) => {
  const o = obj(v, what);
  const entries = Object.entries(o);
  if (entries.length === 0 || entries.length > 10) throw new RuleError(`${what}: choose what to set`);
  for (const [k, x] of entries) {
    property(k, what);
    if (x === null || (typeof x === 'object' && (Array.isArray(x) || Object.keys(x).length > 5))) throw new RuleError(`${what}: bad value for ${k}`);
  }
  return o;
};
const eventName = (v: unknown, what: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!EVENT_NAME.test(s)) throw new RuleError(`${what}: event names are 1 to 60 letters, digits, spaces, '.', '-' or '_'`);
  return s;
};

function parseTrigger(raw: unknown, i: number): Trigger {
  const what = `WHEN ${i + 1}`;
  const t = obj(raw, what);
  switch (t.type) {
    case 'button': {
      const out: Trigger = { type: 'button', device: device(t.device, what) };
      if (t.raw !== undefined) {
        if (typeof t.raw !== 'string' || !t.raw || t.raw.length > 60) throw new RuleError(`${what}: choose a button value`);
        out.raw = t.raw;
      } else {
        out.button = intIn(t.button, 1, 20, `${what}: button`);
        if (typeof t.press !== 'string' || !PRESSES.includes(t.press)) throw new RuleError(`${what}: choose single_click, double_click or long_press`);
        out.press = t.press as PressType;
      }
      return out;
    }
    case 'state': {
      const out: Trigger = { type: 'state', device: device(t.device, what), property: property(t.property, what) };
      if (t.to !== undefined) out.to = scalar(t.to, what);
      if (t.above !== undefined) {
        if (typeof t.above !== 'number' || !Number.isFinite(t.above)) throw new RuleError(`${what}: threshold must be a number`);
        out.above = t.above;
      }
      if (t.below !== undefined) {
        if (typeof t.below !== 'number' || !Number.isFinite(t.below)) throw new RuleError(`${what}: threshold must be a number`);
        out.below = t.below;
      }
      if (t.forMinutes !== undefined) {
        out.forMinutes = intIn(t.forMinutes, 1, 1440, `${what}: minutes`);
        if (t.to === undefined && t.above === undefined && t.below === undefined) throw new RuleError(`${what}: "for N minutes" needs a value or a threshold`);
      }
      return out;
    }
    case 'time':
      if (typeof t.at !== 'string' || !HHMM.test(t.at)) throw new RuleError(`${what}: time must be HH:MM`);
      return { type: 'time', at: t.at, days: days(t.days, what), ...random(t, what) };
    case 'sun':
      if (t.event !== 'sunrise' && t.event !== 'sunset') throw new RuleError(`${what}: choose sunrise or sunset`);
      return { type: 'sun', event: t.event, offset: t.offset === undefined ? 0 : intIn(t.offset, -240, 240, `${what}: offset`), days: days(t.days, what), ...random(t, what) };
    case 'every':
      return { type: 'every', minutes: intIn(t.minutes, 1, 1440, `${what}: minutes`) };
    case 'action':
      return { type: 'action', action: intIn(t.action, 1, 1e9, `${what}: action`) };
    case 'event':
      return { type: 'event', name: eventName(t.name, what) };
    default:
      throw new RuleError(`${what}: unknown event type`);
  }
}

const random = (t: Record<string, unknown>, what: string) => (t.random === undefined || t.random === 0 ? {} : { random: intIn(t.random, 1, 60, `${what}: random minutes`) });

const forMinutes = (c: Record<string, unknown>, what: string) => (c.forMinutes === undefined ? {} : { forMinutes: intIn(c.forMinutes, 1, 1440, `${what}: minutes`) });

function parseCondition(raw: unknown, what: string): Condition {
  const c = obj(raw, what);
  switch (c.type) {
    case 'state': {
      const op = c.op ?? 'eq';
      if (op !== 'eq' && op !== 'ne' && op !== 'gt' && op !== 'lt' && op !== 'between') throw new RuleError(`${what}: choose is, is not, above, below or between`);
      if (op === 'between') {
        const v = c.value;
        if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x)) || v[0] > v[1]) {
          throw new RuleError(`${what}: between needs two numbers, the smaller first`);
        }
        return { type: 'state', device: device(c.device, what), property: property(c.property, what), op, value: [v[0], v[1]], ...forMinutes(c, what) };
      }
      const value = scalar(c.value, what);
      if ((op === 'gt' || op === 'lt') && typeof value !== 'number') throw new RuleError(`${what}: above and below need a number`);
      return { type: 'state', device: device(c.device, what), property: property(c.property, what), op, value, ...forMinutes(c, what) };
    }
    case 'time':
      if (typeof c.from !== 'string' || !HHMM.test(c.from) || typeof c.to !== 'string' || !HHMM.test(c.to)) throw new RuleError(`${what}: times must be HH:MM`);
      if (c.from === c.to) throw new RuleError(`${what}: the time window is empty`);
      return { type: 'time', from: c.from, to: c.to };
    case 'days':
      return { type: 'days', days: days(c.days, what) };
    case 'sun':
      if (c.is !== 'dark' && c.is !== 'light') throw new RuleError(`${what}: choose dark or light`);
      return { type: 'sun', is: c.is };
    case 'group':
      if (c.is !== 'off' && c.is !== 'partly' && c.is !== 'on') throw new RuleError(`${what}: choose off, partly on or on`);
      return { type: 'group', group: intIn(c.group, 1, 1e9, `${what}: light group`), is: c.is };
    default:
      throw new RuleError(`${what}: unknown condition type`);
  }
}

function parseStep(raw: unknown, i: number): RuleStep {
  const what = `THEN ${i + 1}`;
  const s = obj(raw, what);
  const onlyIf = s.onlyIf === undefined || s.onlyIf === null ? undefined : parseCondition(s.onlyIf, `${what} only if`);
  const extra = { ...(onlyIf ? { onlyIf } : {}), ...(s.stop === true ? { stop: true } : {}) };
  switch (s.type) {
    case 'device':
      return { type: 'device', device: device(s.device, what), values: values(s.values, what), ...extra };
    case 'group':
      return { type: 'group', group: intIn(s.group, 1, 1e9, `${what}: group`), values: values(s.values, what), ...extra };
    case 'wait':
      return { type: 'wait', seconds: intIn(s.seconds, 1, MAX_WAIT_SECONDS, `${what}: wait`), ...extra };
    case 'later': {
      const inner = obj(s.step, `${what}: timer`);
      const step: TimedStep =
        inner.type === 'device'
          ? { type: 'device', device: device(inner.device, what), values: values(inner.values, what) }
          : inner.type === 'group'
            ? { type: 'group', group: intIn(inner.group, 1, 1e9, `${what}: group`), values: values(inner.values, what) }
            : (() => {
                throw new RuleError(`${what}: a timer sets a device or a light group`);
              })();
      return { type: 'later', minutes: intIn(s.minutes, 1, 1440, `${what}: minutes`), step, ...extra };
    }
    case 'action':
      return { type: 'action', action: intIn(s.action, 1, 1e9, `${what}: action`), ...extra };
    case 'event':
      return { type: 'event', name: eventName(s.name, what), ...extra };
    case 'notify': {
      const text = typeof s.text === 'string' ? s.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
      if (!text || text.length > 200) throw new RuleError(`${what}: the notification text must be 1 to 200 characters`);
      const level = s.level ?? 'info';
      if (level !== 'info' && level !== 'warning' && level !== 'alarm') throw new RuleError(`${what}: choose info, warning or alarm`);
      return { type: 'notify', text, level, ...extra };
    }
    default:
      throw new RuleError(`${what}: unknown step type`);
  }
}

export function parseRule(input: unknown): Omit<Rule, 'id'> {
  const r = obj(input, 'Rule');
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name || name.length > 80) throw new RuleError('Name must be 1 to 80 characters');
  const notes = r.notes === undefined ? '' : r.notes;
  if (typeof notes !== 'string' || notes.length > 2000) throw new RuleError('Notes must be at most 2000 characters');
  if (!Array.isArray(r.when) || r.when.length === 0 || r.when.length > MAX_EVENTS) throw new RuleError(`A rule needs 1 to ${MAX_EVENTS} events (WHEN)`);
  const cond = r.if === undefined ? { mode: 'all', conditions: [] } : obj(r.if, 'IF');
  if (cond.mode !== 'all' && cond.mode !== 'any') throw new RuleError('IF must be "all" or "any"');
  const conditions = cond.conditions === undefined ? [] : cond.conditions;
  if (!Array.isArray(conditions) || conditions.length > MAX_CONDITIONS) throw new RuleError(`IF holds at most ${MAX_CONDITIONS} conditions`);
  if (!Array.isArray(r.then) || r.then.length === 0 || r.then.length > MAX_STEPS) throw new RuleError(`A rule needs 1 to ${MAX_STEPS} steps (THEN)`);
  const draft = r.draft === true;
  return {
    name,
    enabled: !draft && r.enabled === true,
    draft,
    notes,
    when: r.when.map(parseTrigger),
    if: { mode: cond.mode, conditions: conditions.map((c, i) => parseCondition(c, `IF ${i + 1}`)) },
    then: r.then.map(parseStep),
  };
}

/** Checks a rule against the devices, groups and actions as they are now. Returns problems; an empty list is fine. */
export function checkAgainstDevices(db: Db, zigbee: Pick<DeviceControl, 'knownDevices'> | undefined, rule: RuleDefinition): string[] {
  const problems: string[] = [];
  const registry = new Devices(db);
  const known = (ieee: string) => registry.get(ieee) ?? undefined;
  const z = (ieee: string) => zigbee?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee);
  const checkProperty = (where: string, ieee: string, prop: string, value?: unknown, mustWrite = false) => {
    const row = known(ieee);
    if (!row) return problems.push(`${where}: the device ${ieee} no longer exists`);
    const dev = z(ieee);
    // Devices still to move from Tuya can't be checked yet; their readiness says so.
    if (row.status !== 'joined' || !dev?.definition) return;
    const p = flattenExposes(dev.definition.exposes).find((x) => x.property === prop);
    if (!p) return problems.push(`${where}: ${row.name} has no "${prop}"`);
    if (mustWrite) {
      const err = checkValue(p, value);
      if (err) problems.push(`${where}: ${row.name}: ${err}`);
    }
  };
  rule.when.forEach((t, i) => {
    const where = `WHEN ${i + 1}`;
    if (t.type === 'button') {
      const row = known(t.device);
      if (!row) return problems.push(`${where}: the device ${t.device} no longer exists`);
      const dev = z(t.device);
      if (row.status !== 'joined' || !dev?.definition) return;
      const events = buttonEvents(dev.definition.model, dev.definition.exposes);
      if (events.length === 0) return problems.push(`${where}: ${row.name} reports no button presses`);
      const ok = t.raw !== undefined ? events.some((e) => e.raw === t.raw) : events.some((e) => e.button === t.button && e.press === t.press);
      if (!ok) problems.push(`${where}: ${row.name} has no ${t.raw ?? `button ${t.button} ${t.press}`}`);
    } else if (t.type === 'state') checkProperty(where, t.device, t.property);
    else if (t.type === 'action' && !new Actions(db).get(t.action)) problems.push(`${where}: the action no longer exists`);
  });
  const checkCondition = (where: string, c: Condition) => {
    if (c.type === 'state') checkProperty(where, c.device, c.property);
    if (c.type === 'group' && !new LightGroups(db).summary(c.group)) problems.push(`${where}: the light group no longer exists`);
  };
  rule.if.conditions.forEach((c, i) => checkCondition(`IF ${i + 1}`, c));
  const usesSun = rule.when.some((w) => w.type === 'sun') || [...rule.if.conditions, ...rule.then.map((s) => s.onlyIf)].some((c) => c?.type === 'sun');
  if (usesSun && !validLocation(new Settings(db).get<unknown>(LOCATION_KEY, null))) problems.push('Sunrise and sunset need the home location: set it on the Status page');
  rule.then.forEach((step, i) => {
    const where = `THEN ${i + 1}`;
    if (step.onlyIf) checkCondition(`${where} only if`, step.onlyIf);
    // A timer's step is checked like any other.
    const s: RuleStep = step.type === 'later' ? step.step : step;
    if (s.type === 'device') {
      const row = known(s.device);
      const dev = z(s.device);
      if (!row) problems.push(`${where}: the device ${s.device} no longer exists`);
      else if (row.status === 'joined' && dev?.definition) {
        const problem = checkValues(flattenExposes(dev.definition.exposes), s.values);
        if (problem) problems.push(`${where}: ${row.name}: ${problem}`);
      }
    }
    else if (s.type === 'group' && !new LightGroups(db).summary(s.group)) problems.push(`${where}: the light group no longer exists`);
    else if (s.type === 'action' && !new Actions(db).get(s.action)) problems.push(`${where}: the action no longer exists`);
  });
  return problems;
}

/** Devices and groups a rule uses, for the "ready to enable" hint. */
export function ruleReadiness(db: Db, rule: RuleDefinition): Readiness {
  const refs: Array<{ kind: string; device?: string; group?: number }> = [];
  for (const t of rule.when) if (t.type === 'button' || t.type === 'state') refs.push({ kind: 'device', device: t.device });
  const cond = (c?: Condition) => {
    if (c?.type === 'state') refs.push({ kind: 'device', device: c.device });
    if (c?.type === 'group') refs.push({ kind: 'group', group: c.group });
  };
  rule.if.conditions.forEach(cond);
  for (const step of rule.then) {
    cond(step.onlyIf);
    const s: RuleStep = step.type === 'later' ? step.step : step;
    if (s.type === 'device') refs.push({ kind: 'device', device: s.device });
    if (s.type === 'group') refs.push({ kind: 'group', group: s.group });
  }
  return stepReadiness(db, refs);
}

export class Rules {
  constructor(
    private readonly db: Db,
    private readonly zigbee?: Pick<DeviceControl, 'knownDevices'>,
  ) {}

  list(): RuleView[] {
    return (this.db.prepare('SELECT * FROM rules ORDER BY name').all() as Array<Record<string, unknown>>).map((r) => this.view(this.hydrate(r)));
  }

  get(id: number): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : null;
  }

  view(rule: Rule): RuleView {
    return { ...rule, warnings: checkAgainstDevices(this.db, this.zigbee, rule), readiness: ruleReadiness(this.db, rule) };
  }

  /** Enabled rules, for the engine. */
  enabled(): Rule[] {
    return (this.db.prepare('SELECT * FROM rules WHERE enabled = 1').all() as Array<Record<string, unknown>>).map((r) => this.hydrate(r));
  }

  create(input: unknown): RuleView {
    const rule = parseRule(input);
    this.checkSave(rule);
    const id = Number(
      this.db
        .prepare('INSERT INTO rules (name, enabled, draft, notes, definition_json) VALUES (?, ?, ?, ?, ?)')
        .run(rule.name, Number(rule.enabled), Number(rule.draft), rule.notes, JSON.stringify(definitionOf(rule))).lastInsertRowid,
    );
    return this.view(this.get(id)!);
  }

  update(id: number, input: unknown): RuleView {
    if (!this.get(id)) throw new RuleError('Unknown rule', 404);
    const rule = parseRule(input);
    this.checkSave(rule);
    this.db
      .prepare("UPDATE rules SET name = ?, enabled = ?, draft = ?, notes = ?, definition_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(rule.name, Number(rule.enabled), Number(rule.draft), rule.notes, JSON.stringify(definitionOf(rule)), id);
    return this.view(this.get(id)!);
  }

  setEnabled(id: number, enabled: boolean): RuleView {
    const rule = this.get(id);
    if (!rule) throw new RuleError('Unknown rule', 404);
    const next = { ...rule, enabled, draft: enabled ? false : rule.draft };
    this.checkSave(next);
    this.db.prepare('UPDATE rules SET enabled = ?, draft = ? WHERE id = ?').run(Number(next.enabled), Number(next.draft), id);
    return this.view(this.get(id)!);
  }

  remove(id: number): void {
    if (this.db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes === 0) throw new RuleError('Unknown rule', 404);
  }

  // An enabled rule must use only devices that have joined and must match their capabilities.
  private checkSave(rule: Omit<Rule, 'id'>): void {
    if (!rule.enabled) return;
    const readiness = ruleReadiness(this.db, rule);
    if (!readiness.ready) throw new RuleError(`Can't enable yet: ${readiness.missing.join(', ')}`, 409);
    const problems = checkAgainstDevices(this.db, this.zigbee, rule);
    if (problems.length > 0) throw new RuleError(problems.join('; '));
  }

  private hydrate(r: Record<string, unknown>): Rule {
    const def = JSON.parse(r.definition_json as string) as RuleDefinition;
    return { id: r.id as number, name: r.name as string, enabled: r.enabled === 1, draft: r.draft === 1, notes: r.notes as string, ...def };
  }
}

function definitionOf(rule: RuleDefinition): RuleDefinition {
  return { when: rule.when, if: rule.if, then: rule.then };
}
