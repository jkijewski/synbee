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
      fire: (rule, trigger) => void this.fire(rule, this.describeTrigger(trigger), 0),
    });
    this.later = new LaterSteps(db, { rules, now: () => this.now().getTime(), run: (rule, step, action) => void this.runTimer(rule, step, action) });
    this.settings = new Settings(db);
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
    for (const rule of this.rules.enabled()) {
      const t = timeTrigger(rule, at, this.location());
      if (t) void this.fire(rule, this.describeTrigger(t), 0);
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
      if (t) void this.fire(rule, this.describeTrigger(t), 0);
    }
  }

  private onState(e: DeviceEvents['state']): void {
    for (const rule of this.rules.enabled()) {
      const t = stateTrigger(rule, e);
      if (t) void this.fire(rule, this.describeTrigger(t), 0);
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
  private async fire(rule: Rule, trigger: string, hops: number, opts: { test?: boolean; force?: boolean } = {}): Promise<number | undefined> {
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
          } else await this.runStep(step, hops, rule.id);
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

  private async runStep(step: RuleStep, hops: number, ruleId: number): Promise<void> {
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
        this.deps.notifications.notify({ level: step.level, title: step.text, ruleId, dedupeKey: `rule:${ruleId}:${step.text}` });
        return;
      case 'event':
        // Delivered after this step, so the sending rule is never "still running" for its own chain.
        setImmediate(() => this.sendEvent(step.name, hops + 1));
        return;
      default:
        return;
    }
  }

  private evaluate(c: Condition): ConditionResult {
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
    );
    return { condition: this.describeCondition(c), ...result };
  }

  describeTrigger(t: Trigger): string {
    return this.describer.describeTrigger(t);
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
