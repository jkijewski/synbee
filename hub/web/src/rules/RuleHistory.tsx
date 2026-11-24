import type { Rule, RuleRun } from '../api';
import { useApi } from '../useApi';
import { OUTCOME, when } from './common';

// A rule's run history, refreshed while open, and one run's details.
export function History({ rule, onBack }: { rule: Rule; onBack: () => void }) {
  const { data: runs, error } = useApi<RuleRun[]>(`/api/rules/${rule.id}/runs`, { refreshMs: 3000 });
  return (
    <>
      <button className="btn btn-outline-secondary btn-sm" onClick={onBack}>← All rules</button>
      <div className="card card-body mb-3">
        <h2>History: {rule.name}</h2>
        {error && <p className="text-danger">{error}</p>}
        {runs && runs.length === 0 && <p className="muted">It hasn't run yet.</p>}
        {runs?.map((run) => <RunView key={run.id} run={run} />)}
      </div>
    </>
  );
}

export function RunView({ run }: { run: RuleRun }) {
  return (
    <div className="step">
      <div className="line">
        <span className={`outcome ${run.outcome}`}>{OUTCOME[run.outcome]}</span>
        {run.test && <span className="badge rounded-pill text-bg-light border">test</span>}
        <span className="muted">{when(run.startedAt)}</span>
        <span>{run.trigger}</span>
      </div>
      {run.reason && <p className="small">{run.reason}</p>}
      {run.conditions.length > 0 && (
        <ul className="small">
          {run.conditions.map((c, i) => (
            <li key={i}>
              {c.met ? '✓' : '✗'} {c.condition}
              {c.actual !== undefined && <span className="muted"> (was {String(c.actual)})</span>}
            </li>
          ))}
        </ul>
      )}
      {run.steps.length > 0 && (
        <ol className="small">
          {run.steps.map((s) => (
            <li key={s.step}>
              {s.what}: <strong>{s.status}</strong>
              {s.reason && <span className="muted"> — {s.reason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

