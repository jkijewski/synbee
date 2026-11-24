import type { Db } from './db.js';

// The run history of rules (0010): one row per run, with the outcome, the conditions as evaluated and what each step
// did. The only writer of `rule_runs` (0015).

/** Runs kept per rule; older ones are pruned. */
export const KEEP_RUNS = 200;

export type Outcome = 'running' | 'completed' | 'skipped' | 'failed' | 'stopped' | 'ignored' | 'interrupted';

export interface ConditionResult {
  condition: string;
  met: boolean;
  /** The device value behind a state condition, when there is one. */
  actual?: unknown;
}

export interface StepResult {
  step: number;
  what: string;
  status: 'done' | 'skipped' | 'failed' | 'interrupted' | 'not run';
  reason?: string;
}

export interface RuleRun {
  id: number;
  ruleId: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  test: boolean;
  outcome: Outcome;
  reason: string;
  steps: StepResult[];
  conditions: ConditionResult[];
}

export class RuleRuns {
  constructor(private readonly db: Db) {}

  /** A wait in progress when the hub stopped is abandoned (0010). */
  interruptRunning(at: Date): void {
    this.db.prepare("UPDATE rule_runs SET outcome = 'interrupted', reason = 'The hub restarted during this run', finished_at = ? WHERE outcome = 'running'").run(at.toISOString());
  }

  start(ruleId: number, trigger: string, test: boolean, outcome: Outcome, at: Date, reason = ''): number {
    const iso = at.toISOString();
    return Number(
      this.db
        .prepare('INSERT INTO rule_runs (rule_id, started_at, finished_at, trigger_text, test, outcome, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ruleId, iso, outcome === 'running' ? null : iso, trigger, Number(test), outcome, reason).lastInsertRowid,
    );
  }

  finish(runId: number, ruleId: number, outcome: Outcome, reason: string, steps: StepResult[], conditions: ConditionResult[], at: Date): void {
    this.db
      .prepare('UPDATE rule_runs SET outcome = ?, reason = ?, steps_json = ?, conditions_json = ?, finished_at = ? WHERE id = ?')
      .run(outcome, reason, JSON.stringify(steps), JSON.stringify(conditions), at.toISOString(), runId);
    this.db
      .prepare('DELETE FROM rule_runs WHERE rule_id = ? AND id NOT IN (SELECT id FROM rule_runs WHERE rule_id = ? ORDER BY id DESC LIMIT ?)')
      .run(ruleId, ruleId, KEEP_RUNS);
  }

  get(id: number): RuleRun | null {
    const r = this.db.prepare('SELECT * FROM rule_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? hydrate(r) : null;
  }

  history(ruleId: number, limit = 50): RuleRun[] {
    return (this.db.prepare('SELECT * FROM rule_runs WHERE rule_id = ? ORDER BY id DESC LIMIT ?').all(ruleId, limit) as Array<Record<string, unknown>>).map(hydrate);
  }
}

function hydrate(r: Record<string, unknown>): RuleRun {
  return {
    id: r.id as number,
    ruleId: r.rule_id as number,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    trigger: r.trigger_text as string,
    test: r.test === 1,
    outcome: r.outcome as Outcome,
    reason: r.reason as string,
    steps: JSON.parse(r.steps_json as string) as StepResult[],
    conditions: JSON.parse(r.conditions_json as string) as ConditionResult[],
  };
}
