import type { Db } from './db.js';
import type { Action, Actions, RunResult } from './actions.js';
import type { LightGroups } from './groups.js';
import { RuleError, type Condition, type Rule, type RuleStep, type Rules, type TimedStep, type Trigger } from './rules.js';
import { LaterSteps, type PendingTimer } from './rule-later.js';
import { LOCATION_KEY, Settings } from './settings.js';
import { validLocation, type Location } from './sun.js';
import type { DeviceControl, DeviceEvents } from './ports.js';
import { RuleDescriber } from './rule-describe.js';
import { buttonTrigger, conditionHoldsFor, evaluateCondition, stateTrigger, timeTrigger } from './rule-match.js';
import { DurationTimers } from './rule-durations.js';
import { flattenExposes } from './exposes.js';
import { describeValue } from './features/describe.js';
import { inUnit, temperatureUnit } from './units.js';
import type { ActionIf } from './actions.js';
import type { Check, Checks } from './checks.js';
import type { SensorGroups, TileLevel } from './sensor-groups.js';
import type { History } from './history.js';
import type { Notifications } from './notifications.js';
import { RuleRuns, type ConditionResult, type Outcome, type RuleRun, type StepResult } from './rule-runs.js';

export { KEEP_RUNS, type ConditionResult, type Outcome, type RuleRun, type StepResult } from './rule-runs.js';

// Runs WHEN / IF / THEN rules inside the hub (0010): device, time, action and named events; one condition group;
// ordered steps, each with an optional "only if". Matching is in rule-match.ts, wording in rule-describe.ts and the
// run history in rule-runs.ts; this file decides when rules run and runs their steps.

/** A chain of rules started by each other's events or actions stops after this many links. */
export const HOP_LIMIT = 5;

interface Running {
  runId: number;
  /** What started the run, for the placeholders of notification texts. */
  cause?: Trigger;
  abort: () => void;
  aborted: boolean;
}

export class RuleEngine {
  private running = new Map<number, Running>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly runs: RuleRuns;
  private readonly describer: RuleDescriber;
  private readonly durations: DurationTimers;
  private readonly later: LaterSteps;
  private readonly settings: Settings;
  private readonly db: Db;
  /** The last value of each sensor group ("s<id>") and check ("c<id>") an automation starts on, to see it change. */
  private readonly watched = new Map<string, unknown>();
  /** "For N minutes" waits of sensor group and check events, by rule and event. */
  private readonly holdTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    db: Db,
    private readonly rules: Rules,
    private readonly deps: {
      zigbee?: DeviceControl;
      actions?: Actions;
      groups?: LightGroups;
      /** For "for N minutes" events and conditions (0014). */
      history?: History;
      /** For Notify steps (0014). */
      notifications?: Notifications;
      /** Sensor groups and checks, for conditions and events. */
      sensorGroups?: SensorGroups;
      checks?: Checks;
      now?: () => Date;
      minuteTimer?: boolean;
    } = {},
  ) {
    this.runs = new RuleRuns(db);
    this.describer = new RuleDescriber(db);
    this.durations = new DurationTimers(db, {
      rules,
      now: () => this.now().getTime(),
      since: (ieee, property) => deps.history?.since(ieee, property) ?? null,
      fire: (rule, trigger) => void this.fire(rule, this.describeTrigger(trigger), 0, { cause: trigger }),
    });
    this.later = new LaterSteps(db, { rules, now: () => this.now().getTime(), run: (rule, step, action) => void this.runTimer(rule, step, action) });
    this.settings = new Settings(db);
    this.db = db;
  }

  /** The home's location for sun events and "it is dark", if set (0010). */
  location(): Location | null {
    return validLocation(this.settings.get<unknown>(LOCATION_KEY, null));
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    this.stopped = false;
    this.runs.interruptRunning(this.now());
    this.durations.start();
    this.later.start();
    const { zigbee, actions } = this.deps;
    if (zigbee) {
      const onButton = (e: DeviceEvents['button']) => this.onButton(e);
      const onState = (e: DeviceEvents['state']) => this.onState(e);
      zigbee.on('button', onButton);
      zigbee.on('state', onState);
      const onDuration = (e: DeviceEvents['state']) => this.durations.onState(e);
      zigbee.on('state', onDuration);
      this.unsubscribe.push(() => zigbee.off('state', onDuration));
      this.unsubscribe.push(() => zigbee.off('button', onButton), () => zigbee.off('state', onState));
    }
    if (zigbee) {
      const onWatched = () => this.checkWatched();
      zigbee.on('state', onWatched);
      this.unsubscribe.push(() => zigbee.off('state', onWatched));
    }
    this.checkWatched(true);
    if (actions) {
      const onRan = (e: { action: Action; result: RunResult; hops?: number }) => this.onActionRan(e);
      actions.on('ran', onRan);
      this.unsubscribe.push(() => actions.off('ran', onRan));
    }
    if (this.deps.minuteTimer !== false) this.scheduleMinute();
  }

  /** Stops listening and abandons runs in progress, recording them as interrupted. */
  stop(): void {
    this.durations.stop();
    this.later.stop();
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const r of this.running.values()) r.abort();
    for (const t of this.holdTimers.values()) clearTimeout(t);
    this.holdTimers.clear();
  }

  private scheduleMinute(): void {
    const now = Date.now();
    const next = Math.ceil((now + 1) / 60000) * 60000 + 50;
    this.timer = setTimeout(() => {
      this.tick(this.now());
      if (!this.stopped) this.scheduleMinute();
    }, next - now);
    this.timer.unref?.();
  }

  /** Checks time events for the given minute, in the NAS's time zone. */
  tick(at: Date): void {
    // Checks with a time window or "it is dark" change without a device event.
    this.checkWatched();
    for (const rule of this.rules.enabled()) {
      const t = timeTrigger(rule, at, this.location());
      if (t) void this.fire(rule, this.describeTrigger(t), 0, { cause: t });
    }
  }

  /** Sends a named event, as a rule step does. */
  sendEvent(name: string, hops: number): void {
    for (const rule of this.rules.enabled()) {
      if (rule.when.some((w) => w.type === 'event' && w.name === name)) void this.fire(rule, `Event "${name}"`, hops);
    }
  }

  private onButton(e: DeviceEvents['button']): void {
    for (const rule of this.rules.enabled()) {
      const t = buttonTrigger(rule, e);
      if (t) void this.fire(rule, this.describeTrigger(t), 0, { cause: t });
    }
  }

  private onState(e: DeviceEvents['state']): void {
    for (const rule of this.rules.enabled()) {
      const t = stateTrigger(rule, e);
      if (t) void this.fire(rule, this.describeTrigger(t), 0, { cause: t });
    }
  }

  private onActionRan(e: { action: Action; hops?: number }): void {
    for (const rule of this.rules.enabled()) {
      if (rule.when.some((w) => w.type === 'action' && w.action === e.action.id)) void this.fire(rule, `Action "${e.action.name}" ran`, e.hops ?? 0);
    }
  }

  /** The Test button: runs the steps now. Conditions are checked and reported; `force` runs the steps even if unmet. */
  async test(ruleId: number, force = false): Promise<RuleRun> {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new RuleError('Unknown rule', 404);
    if (this.running.has(ruleId)) throw new RuleError('The rule is running now; try again when it has finished', 409);
    const runId = await this.fire(rule, 'Test', 0, { test: true, force });
    return this.run(runId!)!;
  }

  private insertRun(ruleId: number, trigger: string, test: boolean, outcome: Outcome, reason = ''): number {
    return this.runs.start(ruleId, trigger, test, outcome, this.now(), reason);
  }

  private finishRun(runId: number, ruleId: number, outcome: Outcome, reason: string, steps: StepResult[], conditions: ConditionResult[]): void {
    this.runs.finish(runId, ruleId, outcome, reason, steps, conditions, this.now());
  }

  /** Runs a rule for one event and records the run. Returns the run's id. */
  private async fire(rule: Rule, trigger: string, hops: number, opts: { test?: boolean; force?: boolean; cause?: Trigger } = {}): Promise<number | undefined> {
    const test = opts.test === true;
    if (this.stopped && !test) return undefined;
    if (this.running.has(rule.id)) return this.insertRun(rule.id, trigger, test, 'ignored', 'The rule was still running from an earlier event');
    if (hops > HOP_LIMIT) {
      return this.insertRun(rule.id, trigger, test, 'stopped', `Stopped after a chain of ${HOP_LIMIT} rule events or actions; the rules probably start each other`);
    }
    const runId = this.insertRun(rule.id, trigger, test, 'running');
    let wake: (() => void) | null = null;
    const running: Running = {
      runId,
      cause: opts.cause,
      aborted: false,
      abort: () => {
        running.aborted = true;
        wake?.();
      },
    };
    this.running.set(rule.id, running);
    const steps: StepResult[] = [];
    let conditions: ConditionResult[] = [];
    try {
      conditions = rule.if.conditions.map((c) => this.evaluate(c));
      const met = conditions.length === 0 || (rule.if.mode === 'all' ? conditions.every((c) => c.met) : conditions.some((c) => c.met));
      if (!met && !opts.force) {
        const failed = conditions.filter((c) => !c.met).map((c) => c.condition);
        const reason = rule.if.mode === 'all' ? `Condition not met: ${failed.join('; ')}` : `None of the conditions was met: ${failed.join('; ')}`;
        this.finishRun(runId, rule.id, 'skipped', reason, rule.then.map((s, i) => ({ step: i + 1, what: this.describeStep(s), status: 'not run' })), conditions);
        return runId;
      }
      for (const [i, step] of rule.then.entries()) {
        const what = this.describeStep(step);
        if (running.aborted) {
          steps.push({ step: i + 1, what, status: 'interrupted' });
          continue;
        }
        if (!test && !this.rules.get(rule.id)?.enabled) {
          steps.push({ step: i + 1, what, status: 'not run' });
          for (const [j, rest] of rule.then.entries()) if (j > i) steps.push({ step: j + 1, what: this.describeStep(rest), status: 'not run' });
          this.finishRun(runId, rule.id, 'stopped', 'The rule was disabled or deleted while running', steps, conditions);
          return runId;
        }
        if (step.onlyIf) {
          const c = this.evaluate(step.onlyIf);
          if (!c.met) {
            steps.push({ step: i + 1, what, status: 'skipped', reason: `Only if ${c.condition}${c.actual !== undefined ? ` (it is ${String(c.actual)})` : ''}` });
            continue;
          }
        }
        try {
          if (step.type === 'wait') {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, step.seconds * 1000);
              wake = () => {
                clearTimeout(t);
                resolve();
              };
            });
            wake = null;
            if (running.aborted) {
              steps.push({ step: i + 1, what, status: 'interrupted' });
              continue;
            }
          } else if (step.type === 'later') {
            this.later.arm(rule.id, i, step.minutes, step.step);
          } else await this.runStep(step, hops, rule.id, running.cause);
          steps.push({ step: i + 1, what, status: 'done' });
          if (step.stop) {
            for (const [j, rest] of rule.then.entries()) if (j > i) steps.push({ step: j + 1, what: this.describeStep(rest), status: 'not run', reason: 'Stopped after the previous step' });
            break;
          }
        } catch (err) {
          steps.push({ step: i + 1, what, status: 'failed', reason: (err as Error).message });
          for (const [j, rest] of rule.then.entries()) if (j > i) steps.push({ step: j + 1, what: this.describeStep(rest), status: 'not run' });
          this.finishRun(runId, rule.id, 'failed', `Step ${i + 1} failed: ${(err as Error).message}`, steps, conditions);
          return runId;
        }
      }
      if (running.aborted) this.finishRun(runId, rule.id, 'interrupted', 'The hub stopped during this run', steps, conditions);
      else this.finishRun(runId, rule.id, 'completed', !met ? 'Conditions not met; steps run anyway as a test' : '', steps, conditions);
      return runId;
    } catch (err) {
      this.finishRun(runId, rule.id, 'failed', (err as Error).message, steps, conditions);
      return runId;
    } finally {
      this.running.delete(rule.id);
    }
  }

  private async runStep(step: RuleStep, hops: number, ruleId: number, cause?: Trigger): Promise<void> {
    const { zigbee, actions, groups } = this.deps;
    switch (step.type) {
      case 'device':
        if (!zigbee) throw new Error('Zigbee2MQTT is not connected');
        await zigbee.command(step.device, step.values);
        return;
      case 'group':
        if (!groups) throw new Error('Light groups are not available');
        await groups.command(step.group, step.values);
        return;
      case 'action': {
        if (!actions) throw new Error('Actions are not available');
        const result = await actions.run(step.action, { hops: hops + 1, source: 'rule' });
        if (!result.ok) throw new Error(result.error ?? 'The action failed');
        return;
      }
      case 'notify':
        if (!this.deps.notifications) throw new Error('Notifications are not available');
        {
          const text = this.fillText(step.text, ruleId, cause);
          this.deps.notifications.notify({ level: step.level, title: text, ruleId, dedupeKey: `rule:${ruleId}:${text}` });
        }
        return;
      case 'event':
        // Delivered after this step, so the sending rule is never "still running" for its own chain.
        setImmediate(() => this.sendEvent(step.name, hops + 1));
        return;
      default:
        return;
    }
  }

  private evaluate(c: Condition, inCheck = false): ConditionResult {
    const result = evaluateCondition(
      c,
      (ieee, property) => this.deps.zigbee?.deviceState(ieee)?.[property],
      this.now(),
      (sc, minutes) => {
        const prop = flattenExposes(this.deps.zigbee?.knownDevices().find((d) => d.ieee_address.toLowerCase() === sc.device)?.definition?.exposes).find((p) => p.property === sc.property);
        const decode = (n: number) => (prop?.type === 'binary' ? (n === 1 ? (prop.valueOn ?? true) : (prop.valueOff ?? false)) : n);
        return this.deps.history?.heldFor(sc.device, sc.property, minutes, (v) => conditionHoldsFor(sc, v), decode, this.now().getTime()) ?? false;
      },
      this.location(),
      (group) => this.groupLights(group),
      (group) => {
        const s = this.deps.sensorGroups?.status(group);
        return { value: s?.value ?? null, text: s?.text ?? 'unknown' };
      },
      // A check can't contain another check, so inside one this is never reached.
      (check) => {
        const k = inCheck ? null : this.evaluateCheck(check);
        return { value: k?.value ?? null, text: k?.text ?? 'unknown' };
      },
    );
    return { condition: this.describeCondition(c), ...result };
  }

  describeTrigger(t: Trigger): string {
    return this.describer.describeTrigger(t);
  }

  /** A device value in words ("Open", "21.4 °C"), or as it is. */
  private valueWords(ieee: string, property: string, value: unknown): string {
    const prop = flattenExposes(this.deps.zigbee?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee)?.definition?.exposes).find((p) => p.property === property);
    return inUnit((prop ? describeValue(prop, value) : null) ?? String(value), temperatureUnit(this.db));
  }

  /**
   * Fills a notification text's placeholders from what started the run: {device}, {state} (its value now, in words),
   * {duration} ("5 min" for "and stays so for"), {rule} and {time}. Unknown placeholders stay as they are.
   */
  fillText(text: string, ruleId: number, cause?: Trigger): string {
    const device = cause && 'device' in cause ? cause.device : undefined;
    const property = cause?.type === 'state' ? cause.property : undefined;
    const now = this.now();
    const group = cause?.type === 'sensors' ? cause.group : undefined;
    const checkId = cause?.type === 'check' ? cause.check : undefined;
    const values: Record<string, () => string> = {
      device: () => (device ? this.describer.deviceName(device) : group ? this.describer.sensorGroupName(group) : ''),
      state: () =>
        device && property
          ? this.valueWords(device, property, this.deps.zigbee?.deviceState(device)?.[property])
          : group
            ? (this.deps.sensorGroups?.status(group)?.text ?? '')
            : checkId
              ? (this.evaluateCheck(checkId)?.text ?? '')
              : '',
      check: () => (checkId ? this.describer.checkName(checkId) : ''),
      why: () =>
        checkId
          ? (this.evaluateCheck(checkId)?.why.map((w) => w.text).join(', ') ?? '')
          : group
            ? (this.deps.sensorGroups?.status(group)?.text ?? '')
            : '',
      duration: () => (cause && 'forMinutes' in cause && cause.forMinutes ? `${cause.forMinutes} min` : ''),
      rule: () => this.rules.get(ruleId)?.name ?? '',
      time: () => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    };
    return text.replace(/\{(device|state|duration|rule|time|check|why)\}/g, (_m, k: string) => values[k]!()).replace(/\s{2,}/g, ' ').trim();
  }

  /** A condition's state in words for explanations: "Kitchen window is Open", "Windows: 2 of 5 open: Kitchen, Hall". */
  private conditionWords(c: Condition, r: ConditionResult): { text: string; ieee?: string } {
    if (c.type === 'state' && r.actual !== undefined && r.actual !== 'unknown') return { text: `${this.describer.deviceName(c.device)} is ${this.valueWords(c.device, c.property, r.actual)}`, ieee: c.device };
    if (c.type === 'sensors') return { text: `${this.describer.sensorGroupName(c.group)}: ${String(r.actual)}` };
    if (c.type === 'check') return { text: `"${this.describer.checkName(c.check)}": ${String(r.actual)}` };
    return { text: r.met ? r.condition : `not ${r.condition}` };
  }

  /**
   * A check now: true or false with the owner's words and level, and why: the conditions that made it so. Null when
   * the check doesn't exist.
   */
  evaluateCheck(id: number): { value: boolean; text: string; level: TileLevel; why: Array<{ text: string; ieee?: string }>; check: Check } | null {
    const check = this.deps.checks?.get(id);
    if (!check) return null;
    const results = check.if.conditions.map((c) => ({ c, r: this.evaluate(c, true) }));
    const value = check.if.mode === 'all' ? results.every((x) => x.r.met) : results.some((x) => x.r.met);
    // True: what makes it true. False: what is missing ("all" mode) or that nothing holds ("any" mode).
    const why = results.filter((x) => x.r.met === value || (!value && check.if.mode === 'any')).map(({ c, r }) => this.conditionWords(c, r));
    const side = value ? check.whenTrue : check.whenFalse;
    return { value, text: side.text, level: side.level, why, check };
  }

  /** Sees sensor groups and checks that automations start on change, and fires those automations (with "for N minutes"). */
  private checkWatched(initial = false): void {
    if (this.stopped && !initial) return;
    const rules = this.rules.enabled();
    const keys = new Set<string>();
    for (const r of rules) for (const w of r.when) if (w.type === 'sensors') keys.add(`s${w.group}`);
    else if (w.type === 'check') keys.add(`c${w.check}`);
    for (const key of keys) {
      const id = Number(key.slice(1));
      const now = key[0] === 's' ? (this.deps.sensorGroups?.value(id) ?? null) : (this.evaluateCheck(id)?.value ?? null);
      const before = this.watched.get(key);
      this.watched.set(key, now);
      if (initial || before === undefined || before === now || now === null) continue;
      for (const rule of rules) {
        rule.when.forEach((w, i) => {
          const matches = (w.type === 'sensors' && key === `s${w.group}`) || (w.type === 'check' && key === `c${w.check}`);
          if (!matches) return;
          const slot = `${rule.id}:${i}`;
          const pending = this.holdTimers.get(slot);
          if (pending) (clearTimeout(pending), this.holdTimers.delete(slot));
          if ((w as { becomes: unknown }).becomes !== now) return;
          const minutes = (w as { forMinutes?: number }).forMinutes;
          if (!minutes) {
            void this.fire(rule, this.describeTrigger(w), 0, { cause: w });
            return;
          }
          const t = setTimeout(() => {
            this.holdTimers.delete(slot);
            const still = key[0] === 's' ? this.deps.sensorGroups?.value(id) : this.evaluateCheck(id)?.value;
            if (still === now) void this.fire(rule, this.describeTrigger(w), 0, { cause: w });
          }, minutes * 60_000);
          t.unref?.();
          this.holdTimers.set(slot, t);
        });
      }
    }
  }

  /** An action's IF, checked now (0011): whether it holds and, if not, what isn't true, in words. */
  checkConditions(cond: ActionIf): { met: boolean; reason: string } {
    const results = cond.conditions.map((c) => ({ c, r: this.evaluate(c) }));
    const met = results.length === 0 || (cond.mode === 'all' ? results.every((x) => x.r.met) : results.some((x) => x.r.met));
    const words = results
      .filter((x) => !x.r.met)
      .map(({ c, r }) => (c.type === 'check' ? `"${this.describer.checkName(c.check)}" isn't ${c.is ? 'true' : 'false'}` : this.conditionWords(c, r).text));
    return { met, reason: met ? '' : cond.mode === 'any' ? `none of these holds: ${words.join('; ')}` : words.join('; ') };
  }

  describeCondition(c: Condition): string {
    return this.describer.describeCondition(c);
  }

  describeStep(s: RuleStep): string {
    return this.describer.describeStep(s);
  }

  /** Whether each light of a light group is on, from the lights' reported on/off state (`state`, or `state_<endpoint>`). */
  private groupLights(id: number): Array<boolean | undefined> {
    const group = this.deps.groups?.list().find((g) => g.id === id);
    const { zigbee } = this.deps;
    if (!group || !zigbee) return [];
    return group.members.map((m) => {
      const state = zigbee.deviceState(m.ieee) ?? {};
      const props = flattenExposes(zigbee.knownDevices().find((d) => d.ieee_address.toLowerCase() === m.ieee)?.definition?.exposes);
      const key = m.endpoint !== undefined && `state_l${m.endpoint}` in state ? `state_l${m.endpoint}` : 'state';
      const prop = props.find((p) => p.property === key);
      const value = state[key];
      return value === undefined ? undefined : value === (prop?.valueOn ?? 'ON');
    });
  }

  /** A timer step that ran out: does its step and records it as a run of the rule. */
  private async runTimer(rule: Rule, stepIndex: number, action: TimedStep): Promise<void> {
    const what = this.describeStep(action);
    const runId = this.insertRun(rule.id, `Timer of step ${stepIndex + 1} ran out`, false, 'running');
    try {
      await this.runStep(action, 0, rule.id);
      this.finishRun(runId, rule.id, 'completed', '', [{ step: stepIndex + 1, what, status: 'done' }], []);
    } catch (err) {
      this.finishRun(runId, rule.id, 'failed', `The timer's step failed: ${(err as Error).message}`, [{ step: stepIndex + 1, what, status: 'failed', reason: (err as Error).message }], []);
    }
  }

  /** Timer steps counting down: all, or this rule's. */
  timers(ruleId?: number): PendingTimer[] {
    return this.later.pending().filter((t) => ruleId === undefined || t.ruleId === ruleId);
  }

  /** Stops a timer step's countdown without running it. */
  cancelTimer(ruleId: number, step: number): void {
    this.later.cancel(ruleId, step);
  }

  /** "For N minutes" timers waiting for this rule. */
  armed(ruleId: number): Array<{ slot: string; dueAt: number }> {
    return this.durations.armed(ruleId);
  }

  isRunning(ruleId: number): boolean {
    return this.running.has(ruleId);
  }

  run(id: number): RuleRun | null {
    return this.runs.get(id);
  }

  history(ruleId: number, limit = 50): RuleRun[] {
    return this.runs.history(ruleId, limit);
  }
}
