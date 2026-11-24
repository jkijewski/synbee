import type { Db } from './db.js';
import type { Rule, Rules, TimedStep } from './rules.js';

// Timer steps (0010): "after N minutes, set …", such as a light that switches itself off. Running the step again
// starts its countdown again, so a light switched on repeatedly goes off N minutes after the last time. Timers are
// stored and re-armed after a restart; one that fell due while the hub was down runs as soon as it starts. The only
// writer of `later_steps`.

export interface PendingTimer {
  ruleId: number;
  step: number;
  dueAt: number;
  action: TimedStep;
}

export interface LaterDeps {
  rules: Rules;
  now: () => number;
  /** Runs the timer's step and records it in the rule's history. */
  run: (rule: Rule, stepIndex: number, action: TimedStep) => void;
}

export class LaterSteps {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly deps: LaterDeps,
  ) {}

  start(): void {
    for (const t of this.pending()) {
      if (!this.deps.rules.get(t.ruleId)?.enabled) this.delete(t.ruleId, t.step);
      else this.schedule(t.ruleId, t.step, t.dueAt);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Starts (or starts again) the countdown of a rule's timer step. */
  arm(ruleId: number, step: number, minutes: number, action: TimedStep): number {
    const due = this.deps.now() + minutes * 60_000;
    this.db
      .prepare('INSERT INTO later_steps (rule_id, step, due_at, action) VALUES (?, ?, ?, ?) ON CONFLICT (rule_id, step) DO UPDATE SET due_at = excluded.due_at, action = excluded.action')
      .run(ruleId, step, due, JSON.stringify(action));
    this.schedule(ruleId, step, due);
    return due;
  }

  /** Every timer counting down, soonest first. */
  pending(): PendingTimer[] {
    return (this.db.prepare('SELECT rule_id, step, due_at, action FROM later_steps ORDER BY due_at').all() as Array<{ rule_id: number; step: number; due_at: number; action: string }>).map(
      (r) => ({ ruleId: r.rule_id, step: r.step, dueAt: r.due_at, action: JSON.parse(r.action) as TimedStep }),
    );
  }

  /** Stops a countdown without running it. */
  cancel(ruleId: number, step: number): void {
    const key = `${ruleId}/${step}`;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.delete(ruleId, step);
  }

  private schedule(ruleId: number, step: number, due: number): void {
    const key = `${ruleId}/${step}`;
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => this.due(ruleId, step), Math.max(0, due - this.deps.now()));
    t.unref?.();
    this.timers.set(key, t);
  }

  private due(ruleId: number, step: number): void {
    this.timers.delete(`${ruleId}/${step}`);
    const row = this.db.prepare('SELECT action FROM later_steps WHERE rule_id = ? AND step = ?').get(ruleId, step) as { action: string } | undefined;
    this.delete(ruleId, step);
    const rule = this.deps.rules.get(ruleId);
    if (!row || !rule?.enabled) return;
    this.deps.run(rule, step, JSON.parse(row.action) as TimedStep);
  }

  private delete(ruleId: number, step: number): void {
    this.db.prepare('DELETE FROM later_steps WHERE rule_id = ? AND step = ?').run(ruleId, step);
  }
}
