import { type Choices, type RuleStep, type TimedStep } from '../api';
import { defaultValue, ValuesEditor } from '../Values';
import { ConditionEditor } from './ConditionEditor';
import { defaultCondition, defaultStep, DeviceSelect } from './RuleParts';

// THEN: one step, with an optional "only if".
export function StepEditor({ step: s, choices, onChange }: { step: RuleStep; choices: Choices; onChange: (s: RuleStep) => void }) {
  const onlyIf = s.onlyIf;
  const keep = (n: RuleStep): RuleStep => (onlyIf ? { ...n, onlyIf } : n);
  const writable = choices.devices.filter((d) => d.properties.some((p) => p.writable));
  return (
    <>
      <div className="line">
        <select className="form-select form-select-sm"
          aria-label="Step type"
          value={s.type}
          onChange={(e) => {
            const type = e.target.value;
            if (type === 'device') onChange(keep(defaultStep(choices).type === 'device' ? defaultStep(choices) : { type: 'device', device: '', values: {} }));
            else if (type === 'group') onChange(keep({ type: 'group', group: choices.groups[0]?.id ?? 0, values: {} }));
            else if (type === 'wait') onChange(keep({ type: 'wait', seconds: 60 }));
            else if (type === 'action') onChange(keep({ type: 'action', action: choices.actions[0]?.id ?? 0 }));
            else if (type === 'notify') onChange(keep({ type: 'notify', text: '', level: 'info' }));
            else if (type === 'later') {
              const first = defaultStep(choices);
              const step: TimedStep = first.type === 'device' ? { type: 'device', device: first.device, values: { state: 'OFF' } } : { type: 'group', group: choices.groups[0]?.id ?? 0, values: { state: 'OFF' } };
              onChange(keep({ type: 'later', minutes: 10, step }));
            }
            else onChange(keep({ type: 'event', name: '' }));
          }}
        >
          <option value="device">Set a device</option>
          {choices.groups.length > 0 && <option value="group">Set a light group</option>}
          <option value="wait">Wait</option>
          <option value="later">Start a timer (e.g. auto-off)</option>
          <option value="action">Run an action</option>
          <option value="event">Send an event</option>
          <option value="notify">Send a notification</option>
        </select>
        {(s.type === 'device' || s.type === 'group') && <TargetEditor step={s} choices={choices} onChange={(t) => onChange(keep({ ...t, ...(s.stop ? { stop: true } : {}) }))} />}
        {s.type === 'later' && (
          <>
            <label className="line">
              after
              <input
                className="form-control form-control-sm"
                type="number"
                min={1}
                max={1440}
                aria-label="Timer minutes"
                value={s.minutes}
                onChange={(e) => onChange({ ...s, minutes: Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                style={{ width: '5rem' }}
              />
              min:
            </label>
            {choices.groups.length > 0 && (
              <select
                className="form-select form-select-sm"
                aria-label="Timer sets"
                value={s.step.type}
                onChange={(e) =>
                  onChange({
                    ...s,
                    step:
                      e.target.value === 'group'
                        ? { type: 'group', group: choices.groups[0]?.id ?? 0, values: { state: 'OFF' } }
                        : { type: 'device', device: writable[0]?.ieee ?? '', values: { state: 'OFF' } },
                  })
                }
                style={{ width: 'auto' }}
              >
                <option value="device">set a device</option>
                <option value="group">set a light group</option>
              </select>
            )}
            <TargetEditor step={s.step} choices={choices} onChange={(step) => onChange({ ...s, step })} />
            <span className="muted small w-100">Runs N minutes after this step; running the rule again starts the countdown again.</span>
          </>
        )}
        {s.type === 'wait' && (
          <label className="line">
            <input className="form-control form-control-sm" type="number" min={1} max={86400} value={s.seconds} onChange={(e) => onChange({ ...s, seconds: Number(e.target.value) })} style={{ width: '6rem' }} />
            seconds
          </label>
        )}
        {s.type === 'action' && (
          <select className="form-select form-select-sm" aria-label="Action" value={s.action} onChange={(e) => onChange({ ...s, action: Number(e.target.value) })}>
            {choices.actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {s.type === 'event' && <input className="form-control form-control-sm" aria-label="Event name" placeholder="event name" value={s.name} maxLength={60} onChange={(e) => onChange({ ...s, name: e.target.value })} />}
        {s.type === 'notify' && (
          <>
            <select className="form-select form-select-sm" aria-label="Notification level" value={s.level} onChange={(e) => onChange({ ...s, level: e.target.value as 'info' | 'warning' | 'alarm' })} style={{ width: 'auto' }}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="alarm">Alarm</option>
            </select>
            <input className="form-control form-control-sm" aria-label="Notification text" placeholder="e.g. The front door is open" value={s.text} maxLength={200} onChange={(e) => onChange({ ...s, text: e.target.value })} style={{ minWidth: "18rem", flex: 1 }} />
          </>
        )}
      </div>
      <div className="line only-if">
        <label className="line">
          <input className="form-check-input"
            type="checkbox"
            checked={Boolean(onlyIf)}
            onChange={(e) => {
              if (e.target.checked) onChange({ ...s, onlyIf: defaultCondition(choices) });
              else {
                const { onlyIf: _drop, ...rest } = s;
                onChange(rest as RuleStep);
              }
            }}
          />
          only if
        </label>
        <label className="line" title="If this step runs, the rule ends after it">
          <input className="form-check-input" type="checkbox" checked={Boolean(s.stop)} onChange={(e) => onChange({ ...s, stop: e.target.checked || undefined } as RuleStep)} />
          then stop
        </label>
        {onlyIf && <ConditionEditor condition={onlyIf} choices={choices} onChange={(c) => onChange({ ...s, onlyIf: c })} />}
      </div>
    </>
  );
}


/** Sets a device or a light group: a step's target and values, also used inside a timer step. */
function TargetEditor({ step: s, choices, onChange }: { step: TimedStep; choices: Choices; onChange: (s: TimedStep) => void }) {
  const writable = choices.devices.filter((d) => d.properties.some((p) => p.writable));
  if (s.type === 'device') {
    const device = choices.devices.find((d) => d.ieee === s.device);
    return (
      <>
        <DeviceSelect
          all={choices.devices}
          devices={writable}
          value={s.device}
          onChange={(ieee) => {
            const p = choices.devices.find((d) => d.ieee === ieee)?.properties.find((x) => x.writable);
            onChange({ type: 'device', device: ieee, values: p ? { [p.property]: defaultValue(p) } : {} });
          }}
        />
        <ValuesEditor properties={device?.properties ?? []} labels={device?.labels} values={s.values} onChange={(values) => onChange({ ...s, values })} canFade={device?.fades !== false} />
      </>
    );
  }
  const group = choices.groups.find((g) => g.id === s.group);
  return (
    <>
      <select className="form-select form-select-sm" aria-label="Light group" value={s.group} onChange={(e) => onChange({ type: 'group', group: Number(e.target.value), values: {} })}>
        {choices.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.created ? '' : ' (not created yet)'}
          </option>
        ))}
      </select>
      <ValuesEditor properties={group?.properties ?? []} values={s.values} onChange={(values) => onChange({ ...s, values })} canFade={group?.fades !== false} />
    </>
  );
}
