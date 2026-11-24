import type { Db } from './db.js';
import type { DeviceEvents } from './ports.js';
import { durationHolds } from './rule-match.js';
import type { Rule, Rules, Trigger } from './rules.js';

// "Stays … for N minutes" events (0014), such as no motion for 10 minutes or a door open for 5. A timer is armed when
// the device enters the state and cancelled when it leaves. Timers are stored, so a hub restart re-arms them; when the
// device's state is replayed after a restart, the time already spent in it counts. After firing, a timer stays
// "spent" until the state ends, so a rule fires once per stay. The only writer of `duration_timers`.

type StateTrigger = Extract<Trigger, { type: 'state' }>;
const SPENT = 0;

export interface DurationDeps {
  rules: Rules;
  now: () => number;
  /** When the device's current value began, from history, for re-arming after a restart. */
  since?: (ieee: string, property: string) => { value: unknown; since: number } | null;
  fire: (rule: Rule, trigger: StateTrigger) => void;
}

export class DurationTimers {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly deps: DurationDeps,
  ) {}

  /** Re-arms stored timers, dropping those whose rule was disabled, changed or deleted meanwhile. */
  start(): void {
    const rows = this.db.prepare('SELECT rule_id, slot, due_at FROM duration_timers').all() as Array<{ rule_id: number; slot: string; due_at: number }>;
    for (const r of rows) {
      const found = this.find(r.rule_id, r.slot);
      if (!found) this.delete(r.rule_id, r.slot);
      else if (r.due_at !== SPENT) this.schedule(r.rule_id, r.slot, r.due_at);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  onState(e: DeviceEvents['state']): void {
    for (const rule of this.deps.rules.enabled()) {
      rule.when.forEach((w, i) => {
        if (w.type !== 'state' || w.forMinutes === undefined || w.device !== e.ieee || !(w.property in e.state)) return;
        const slot = String(i);
        const row = this.db.prepare('SELECT due_at FROM duration_timers WHERE rule_id = ? AND slot = ?').get(rule.id, slot) as { due_at: number } | undefined;
        if (!durationHolds(w, e.state[w.property])) {
          if (row) this.cancel(rule.id, slot);
          return;
        }
        if (row) return;
        // Entering the state now, or (after a restart, when states are replayed) already in it since history says.
        const replayed = !(w.property in e.previous);
        const known = replayed ? this.deps.since?.(e.ieee, w.property) : null;
        const start = known && known.value === e.state[w.property] ? known.since : this.deps.now();
        const due = start + w.forMinutes * 60_000;
        this.db.prepare('INSERT INTO duration_timers (rule_id, slot, due_at, trigger_text) VALUES (?, ?, ?, ?)').run(rule.id, slot, due, '');
        this.schedule(rule.id, slot, due);
      });
    }
  }

  /** Timers waiting now, for the rule page. */
  armed(ruleId: number): Array<{ slot: string; dueAt: number }> {
    return (this.db.prepare('SELECT slot, due_at FROM duration_timers WHERE rule_id = ? AND due_at != 0').all(ruleId) as Array<{ slot: string; due_at: number }>).map((r) => ({
      slot: r.slot,
      dueAt: r.due_at,
    }));
  }

  private find(ruleId: number, slot: string): { rule: Rule; trigger: StateTrigger } | null {
    const rule = this.deps.rules.get(ruleId);
    const t = rule?.when[Number(slot)];
    return rule?.enabled && t?.type === 'state' && t.forMinutes !== undefined ? { rule, trigger: t } : null;
  }

  private schedule(ruleId: number, slot: string, due: number): void {
    const key = `${ruleId}/${slot}`;
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => this.due(ruleId, slot), Math.max(0, due - this.deps.now()));
    t.unref?.();
    this.timers.set(key, t);
  }

  private due(ruleId: number, slot: string): void {
    this.timers.delete(`${ruleId}/${slot}`);
    const found = this.find(ruleId, slot);
    if (!found) return this.delete(ruleId, slot);
    this.db.prepare('UPDATE duration_timers SET due_at = ? WHERE rule_id = ? AND slot = ?').run(SPENT, ruleId, slot);
    this.deps.fire(found.rule, found.trigger);
  }

  private cancel(ruleId: number, slot: string): void {
    const key = `${ruleId}/${slot}`;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.delete(ruleId, slot);
  }

  private delete(ruleId: number, slot: string): void {
    this.db.prepare('DELETE FROM duration_timers WHERE rule_id = ? AND slot = ?').run(ruleId, slot);
  }
}
