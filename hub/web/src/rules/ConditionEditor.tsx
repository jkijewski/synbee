import { propertyLabel, type Choices, type Condition } from '../api';
import { ValueInput } from '../Values';
import { defaultCondition, DeviceSelect, Days, readable } from './RuleParts';

// IF: one condition that must hold.
export function ConditionEditor({ condition: c, choices, onChange, noChecks }: { condition: Condition; choices: Choices; onChange: (c: Condition) => void; noChecks?: boolean }) {
  const sensorGroups = choices.sensorGroups ?? [];
  const checks = noChecks ? [] : (choices.checks ?? []);
  const devices = choices.devices.filter((d) => readable(d).length > 0);
  return (
    <div className="line">
      <select className="form-select form-select-sm"
        aria-label="Condition type"
        value={c.type}
        onChange={(e) => {
          const type = e.target.value;
          if (type === 'state') onChange(defaultCondition(choices));
          else if (type === 'time') onChange({ type: 'time', from: '18:00', to: '23:00' });
          else if (type === 'sun') onChange({ type: 'sun', is: 'dark' });
          else if (type === 'group') onChange({ type: 'group', group: choices.groups[0]?.id ?? 0, is: 'on' });
          else if (type === 'sensors') onChange({ type: 'sensors', group: sensorGroups[0]?.id ?? 0, is: 'none' });
          else if (type === 'check') onChange({ type: 'check', check: checks[0]?.id ?? 0, is: true });
          else onChange({ type: 'days', days: [1, 2, 3, 4, 5] });
        }}
      >
        <option value="state">A device is…</option>
        {(choices.groups.length > 0 || c.type === 'group') && <option value="group">A light group is…</option>}
        {(sensorGroups.length > 0 || c.type === 'sensors') && <option value="sensors">A sensor group is…</option>}
        {(checks.length > 0 || c.type === 'check') && <option value="check">A check is…</option>}
        <option value="time">Time is between…</option>
        <option value="days">Day is…</option>
        <option value="sun">It is dark or light…</option>
      </select>
      {c.type === 'state' && (() => {
        const device = choices.devices.find((d) => d.ieee === c.device);
        const props = readable(device);
        const p = props.find((x) => x.property === c.property);
        return (
          <>
            <DeviceSelect all={choices.devices} devices={devices} value={c.device} onChange={(ieee) => onChange({ ...c, device: ieee, property: readable(choices.devices.find((d) => d.ieee === ieee))[0]?.property ?? '' })} />
            <select className="form-select form-select-sm" aria-label="Property" value={c.property} onChange={(e) => onChange({ ...c, property: e.target.value })}>
              {props.map((x) => (
                <option key={x.property} value={x.property}>
                  {propertyLabel(x, device?.labels)}
                </option>
              ))}
            </select>
            <select
              className="form-select form-select-sm"
              aria-label="Comparison"
              value={c.op}
              onChange={(e) => {
                const op = e.target.value as Extract<Condition, { type: 'state' }>['op'];
                const lo = p?.min ?? 0;
                const hi = p?.max ?? 100;
                onChange({ ...c, op, value: op === 'between' ? [Math.round(lo + (hi - lo) / 4), Math.round(lo + ((hi - lo) * 3) / 4)] : Array.isArray(c.value) ? c.value[0] : c.value });
              }}
            >
              <option value="eq">is</option>
              <option value="ne">is not</option>
              {p?.type === 'numeric' && <option value="gt">is above</option>}
              {p?.type === 'numeric' && <option value="lt">is below</option>}
              {p?.type === 'numeric' && <option value="between">is between</option>}
            </select>
            {p && c.op === 'between' && Array.isArray(c.value) ? (
              <>
                <ValueInput prop={p} value={c.value[0]} onChange={(v) => onChange({ ...c, value: [v, (c.value as unknown[])[1]] })} />
                and
                <ValueInput prop={p} value={c.value[1]} onChange={(v) => onChange({ ...c, value: [(c.value as unknown[])[0], v] })} />
              </>
            ) : (
              p && <ValueInput prop={{ ...p, valueToggle: undefined }} value={c.value} onChange={(v) => onChange({ ...c, value: v })} />
            )}
            <label className="d-flex align-items-center gap-1 small mb-0">
              <input
                className="form-check-input mt-0"
                type="checkbox"
                checked={c.forMinutes !== undefined}
                onChange={(e) => {
                  const { forMinutes: _drop, ...rest } = c;
                  onChange(e.target.checked ? { ...c, forMinutes: 10 } : rest);
                }}
              />
              for at least
            </label>
            {c.forMinutes !== undefined && (
              <span className="d-flex align-items-center gap-1">
                <input
                  className="form-control form-control-sm"
                  type="number"
                  min={1}
                  max={1440}
                  aria-label="Minutes"
                  value={c.forMinutes}
                  onChange={(e) => onChange({ ...c, forMinutes: Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                  style={{ width: '5rem' }}
                />
                min
              </span>
            )}
          </>
        );
      })()}
      {c.type === 'time' && (
        <>
          <input className="form-control form-control-sm" aria-label="From" type="time" value={c.from} onChange={(e) => onChange({ ...c, from: e.target.value })} />
          and
          <input className="form-control form-control-sm" aria-label="To" type="time" value={c.to} onChange={(e) => onChange({ ...c, to: e.target.value })} />
        </>
      )}
      {c.type === 'days' && <Days days={c.days} onChange={(days) => onChange({ ...c, days })} />}
      {c.type === 'group' && (
        <>
          <select className="form-select form-select-sm" aria-label="Light group" value={c.group} onChange={(e) => onChange({ ...c, group: Number(e.target.value) })} style={{ width: 'auto' }}>
            {choices.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm" aria-label="Group status" value={c.is} onChange={(e) => onChange({ ...c, is: e.target.value as 'off' | 'partly' | 'on' })} style={{ width: 'auto' }}>
            <option value="off">off (all lights off)</option>
            <option value="partly">partly on (some on, some off)</option>
            <option value="on">on (all lights on)</option>
          </select>
        </>
      )}
      {c.type === 'sensors' && (() => {
        const w = sensorGroups.find((g) => g.id === c.group)?.words ?? { active: 'on', inactive: 'off' };
        return (
          <>
            <select className="form-select form-select-sm" aria-label="Sensor group" value={c.group} onChange={(e) => onChange({ ...c, group: Number(e.target.value) })} style={{ width: 'auto' }}>
              {sensorGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select className="form-select form-select-sm" aria-label="Sensor group state" value={c.is} onChange={(e) => onChange({ ...c, is: e.target.value as 'none' | 'some' | 'all' })} style={{ width: 'auto' }}>
              <option value="none">all {w.inactive}</option>
              <option value="some">some {w.active}</option>
              <option value="all">all {w.active}</option>
            </select>
          </>
        );
      })()}
      {c.type === 'check' && (
        <>
          <select className="form-select form-select-sm" aria-label="Check" value={c.check} onChange={(e) => onChange({ ...c, check: Number(e.target.value) })} style={{ width: 'auto' }}>
            {checks.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm" aria-label="True or false" value={String(c.is)} onChange={(e) => onChange({ ...c, is: e.target.value === 'true' })} style={{ width: 'auto' }}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </>
      )}
      {c.type === 'sun' && (
        <select className="form-select form-select-sm" aria-label="Dark or light" value={c.is} onChange={(e) => onChange({ ...c, is: e.target.value as 'dark' | 'light' })} style={{ width: 'auto' }}>
          <option value="dark">dark (sunset to sunrise)</option>
          <option value="light">light (sunrise to sunset)</option>
        </select>
      )}
    </div>
  );
}

