import { useState } from 'react';
import { api, ApiError, type Choices, type Rule, type RuleRun } from '../api';
import { Related } from '../Related';
import { useApi } from '../useApi';
import { RunView } from './RuleHistory';
import { ConditionEditor } from './ConditionEditor';
import { defaultCondition, defaultStep, defaultTrigger, Item } from './RuleParts';
import { StepEditor } from './StepEditor';
import { TriggerEditor } from './TriggerEditor';

// Editing one rule: its events, conditions and steps, with Save and Test.
export function RuleEditor({ initial, onDone }: { initial: Rule; onDone: () => void }) {
  const [rule, setRule] = useState<Rule>(initial);
  const [advanced, setAdvanced] = useState(false);
  const { data: choices, error: loadError } = useApi<Choices>('/api/rule-choices');
  const [error, setError] = useState('');
  const [lastTest, setLastTest] = useState<RuleRun | null>(null);

  const body = () => ({ name: rule.name, enabled: rule.enabled, draft: rule.draft, notes: rule.notes, when: rule.when, if: rule.if, then: rule.then });
  const save = async (close = true) => {
    setError('');
    try {
      const saved = rule.id ? await api<Rule>('PUT', `/api/rules/${rule.id}`, body()) : await api<Rule>('POST', '/api/rules', body());
      setRule({ ...rule, id: saved.id });
      if (close) onDone();
      return saved.id;
    } catch (err) {
      setError((err as ApiError).message);
      return undefined;
    }
  };
  const test = async (force: boolean) => {
    setLastTest(null);
    const id = await save(false);
    if (!id) return;
    try {
      setLastTest(await api<RuleRun>('POST', `/api/rules/${id}/test`, { force }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  if (!choices) return <p className="card card-body mb-3 muted">{loadError || error || 'Loading…'}</p>;
  // Events and conditions offer settings and diagnostics (0008) only on request, or when the rule already uses one.
  const isAdvanced = (ieee: string, property: string) => Boolean(choices.devices.find((d) => d.ieee === ieee)?.properties.find((p) => p.property === property)?.category);
  const usesAdvanced = [...rule.when, ...rule.if.conditions].some((x) => 'property' in x && 'device' in x && isAdvanced(x.device, x.property));
  const showAdvanced = advanced || usesAdvanced;
  const simple: Choices = showAdvanced ? choices : { ...choices, devices: choices.devices.map((d) => ({ ...d, properties: d.properties.filter((p) => !p.category) })) };
  const set = (patch: Partial<Rule>) => setRule({ ...rule, ...patch });

  return (
    <div className="editor">
      <div className="card card-body mb-3">
        <h2>{rule.id ? 'Edit rule' : 'New rule'}</h2>
        <label>
          Name
          <input className="form-control form-control-sm" value={rule.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="line">
          <input className="form-check-input" type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked, draft: e.target.checked ? false : rule.draft })} />
          Enabled
        </label>
        {rule.notes && <p className="muted small">{rule.notes}</p>}
      </div>

      <div className="card card-body mb-3 card-when">
        <div className="line">
          <h3 style={{ marginRight: 'auto' }}>WHEN</h3>
          <label className="small muted d-flex align-items-center gap-1 mb-0">
            <input className="form-check-input mt-0" type="checkbox" checked={showAdvanced} disabled={usesAdvanced} onChange={(e) => setAdvanced(e.target.checked)} />
            Show device settings and diagnostics
          </label>
        </div>
        <p className="muted small">Any one of these starts the rule.</p>
        {rule.when.map((t, i) => (
          <Item key={i} onRemove={() => set({ when: rule.when.filter((_, j) => j !== i) })}>
            <TriggerEditor trigger={t} choices={simple} onChange={(n) => set({ when: rule.when.map((x, j) => (j === i ? n : x)) })} />
          </Item>
        ))}
        <button className="btn btn-outline-secondary btn-sm" onClick={() => set({ when: [...rule.when, defaultTrigger(simple)] })}>Add event</button>
      </div>

      <div className="card card-body mb-3 card-if">
        <h3>IF</h3>
        <div className="line">
          <select className="form-select form-select-sm" aria-label="Combine conditions" value={rule.if.mode} onChange={(e) => set({ if: { ...rule.if, mode: e.target.value as 'all' | 'any' } })}>
            <option value="all">All of these are true</option>
            <option value="any">Any of these is true</option>
          </select>
          {rule.if.conditions.length === 0 && <span className="muted small">No conditions: the steps always run.</span>}
        </div>
        {rule.if.conditions.map((c, i) => (
          <Item key={i} onRemove={() => set({ if: { ...rule.if, conditions: rule.if.conditions.filter((_, j) => j !== i) } })}>
            <ConditionEditor condition={c} choices={simple} onChange={(n) => set({ if: { ...rule.if, conditions: rule.if.conditions.map((x, j) => (j === i ? n : x)) } })} />
          </Item>
        ))}
        <button className="btn btn-outline-secondary btn-sm" onClick={() => set({ if: { ...rule.if, conditions: [...rule.if.conditions, defaultCondition(simple)] } })}>Add condition</button>
      </div>

      <div className="card card-body mb-3 card-then">
        <h3>THEN</h3>
        <p className="muted small">Steps run in order. A failed step stops the rest.</p>
        {rule.then.map((s, i) => (
          <Item key={i} title={`Step ${i + 1}`} onRemove={() => set({ then: rule.then.filter((_, j) => j !== i) })}>
            <StepEditor step={s} choices={choices} onChange={(n) => set({ then: rule.then.map((x, j) => (j === i ? n : x)) })} />
          </Item>
        ))}
        <button className="btn btn-outline-secondary btn-sm" onClick={() => set({ then: [...rule.then, defaultStep(choices)] })}>Add step</button>
      </div>

      <div className="card card-body mb-3">
        {error && <p className="text-danger">{error}</p>}
        <div className="line">
          <button className="btn btn-primary btn-sm" onClick={() => void save()}>
            Save
          </button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => void test(false)}>Save and test</button>
          {lastTest?.outcome === 'skipped' && <button className="btn btn-outline-secondary btn-sm" onClick={() => void test(true)}>Run the steps anyway</button>}
          <button className="btn btn-outline-secondary btn-sm" onClick={onDone}>Cancel</button>
        </div>
        {lastTest && <RunView run={lastTest} />}
      </div>
      {rule.id !== undefined && <Related kind="rule" id={rule.id} refresh={lastTest} />}
    </div>
  );
}
