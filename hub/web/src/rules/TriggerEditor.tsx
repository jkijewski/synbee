import { propertyLabel, valueChoices, type Choices, type Trigger } from '../api';
import { ValueInput } from '../Values';
import { ALL_DAYS, PRESS_NAMES } from './common';
import { defaultTrigger, DeviceSelect, Days, readable, withEvents } from './RuleParts';

// WHEN: one event that starts the rule.
export function TriggerEditor({ trigger: t, choices, onChange }: { trigger: Trigger; choices: Choices; onChange: (t: Trigger) => void }) {
  const types: Array<[Trigger['type'], string]> = [
    ['button', 'A button is pressed'],
    ['state', 'A device changes'],
    ['time', 'At a time'],
    ['sun', 'At sunrise or sunset'],
    ['every', 'Every few minutes'],
    ['action', 'An action runs'],
    ['event', 'A rule sends an event'],
    ...((choices.sensorGroups?.length ?? 0) > 0 || t.type === 'sensors' ? [['sensors', 'A sensor group changes'] as [Trigger['type'], string]] : []),
    ...((choices.checks?.length ?? 0) > 0 || t.type === 'check' ? [['check', 'A check changes'] as [Trigger['type'], string]] : []),
  ];
  const changeType = (type: Trigger['type']) => {
    if (type === 'button') onChange(defaultTrigger(choices));
    else if (type === 'state') {
      const d = choices.devices.find((x) => readable(x).length > 0);
      onChange({ type: 'state', device: d?.ieee ?? '', property: readable(d)[0]?.property ?? '' });
    } else if (type === 'time') onChange({ type: 'time', at: '22:00', days: ALL_DAYS });
    else if (type === 'sun') onChange({ type: 'sun', event: 'sunset', offset: 0, days: ALL_DAYS });
    else if (type === 'every') onChange({ type: 'every', minutes: 15 });
    else if (type === 'action') onChange({ type: 'action', action: choices.actions[0]?.id ?? 0 });
    else if (type === 'sensors') onChange({ type: 'sensors', group: choices.sensorGroups?.[0]?.id ?? 0, becomes: 'some' });
    else if (type === 'check') onChange({ type: 'check', check: choices.checks?.[0]?.id ?? 0, becomes: true });
    else onChange({ type: 'event', name: '' });
  };
  return (
    <div className="line">
      <select className="form-select form-select-sm" aria-label="Event type" value={t.type} onChange={(e) => changeType(e.target.value as Trigger['type'])}>
        {types.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {t.type === 'button' && (
        <>
          <DeviceSelect all={choices.devices}
            devices={withEvents(choices)}
            value={t.device}
            onChange={(ieee) => {
              const e = choices.devices.find((d) => d.ieee === ieee)?.events[0];
              onChange(e?.button ? { type: 'button', device: ieee, button: e.button, press: e.press } : { type: 'button', device: ieee, raw: e?.raw ?? '' });
            }}
          />
          <select className="form-select form-select-sm"
            aria-label="Press"
            value={t.raw ?? `${t.button}:${t.press}`}
            onChange={(e) => {
              const ev = choices.devices.find((d) => d.ieee === t.device)?.events.find((x) => (x.button ? `${x.button}:${x.press}` : x.raw) === e.target.value);
              if (ev) onChange(ev.button ? { type: 'button', device: t.device, button: ev.button, press: ev.press } : { type: 'button', device: t.device, raw: ev.raw });
            }}
          >
            {choices.devices
              .find((d) => d.ieee === t.device)
              ?.events.map((ev) => (
                <option key={ev.raw} value={ev.button ? `${ev.button}:${ev.press}` : ev.raw}>
                  {ev.button ? `button ${ev.button}, ${PRESS_NAMES[ev.press!] ?? ev.press}` : ev.raw}
                </option>
              ))}
          </select>
        </>
      )}
      {t.type === 'state' && <StateTrigger t={t} choices={choices} onChange={onChange} />}
      {t.type === 'time' && (
        <>
          <input className="form-control form-control-sm" aria-label="Time" type="time" value={t.at} onChange={(e) => onChange({ ...t, at: e.target.value })} />
          <Days days={t.days} onChange={(days) => onChange({ ...t, days })} />
          <RandomOffset t={t} onChange={onChange} />
        </>
      )}
      {t.type === 'sun' && (
        <>
          <input
            className="form-control form-control-sm"
            type="number"
            min={0}
            max={240}
            aria-label="Minutes from the sun event"
            value={Math.abs(t.offset)}
            onChange={(e) => onChange({ ...t, offset: Math.min(240, Math.max(0, Math.round(Number(e.target.value) || 0))) * (t.offset < 0 ? -1 : 1) })}
            style={{ width: '5rem' }}
          />
          <select className="form-select form-select-sm" aria-label="Before or after" value={t.offset < 0 ? 'before' : 'after'} onChange={(e) => onChange({ ...t, offset: Math.abs(t.offset) * (e.target.value === 'before' ? -1 : 1) })} style={{ width: 'auto' }}>
            <option value="after">min after</option>
            <option value="before">min before</option>
          </select>
          <select className="form-select form-select-sm" aria-label="Sun event" value={t.event} onChange={(e) => onChange({ ...t, event: e.target.value as 'sunrise' | 'sunset' })} style={{ width: 'auto' }}>
            <option value="sunset">sunset</option>
            <option value="sunrise">sunrise</option>
          </select>
          <Days days={t.days} onChange={(days) => onChange({ ...t, days })} />
          <RandomOffset t={t} onChange={onChange} />
        </>
      )}
      {t.type === 'every' && (
        <label className="line">
          every
          <input className="form-control form-control-sm" type="number" min={1} max={1440} value={t.minutes} onChange={(e) => onChange({ ...t, minutes: Number(e.target.value) })} style={{ width: '5rem' }} />
          minutes
        </label>
      )}
      {t.type === 'action' && (
        <select className="form-select form-select-sm" aria-label="Action" value={t.action} onChange={(e) => onChange({ ...t, action: Number(e.target.value) })}>
          {choices.actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      {(t.type === 'sensors' || t.type === 'check') && (
        <>
          {t.type === 'sensors' ? (
            <>
              <select className="form-select form-select-sm" aria-label="Sensor group" value={t.group} onChange={(e) => onChange({ ...t, group: Number(e.target.value) })} style={{ width: 'auto' }}>
                {(choices.sensorGroups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              becomes
              {(() => {
                const w = choices.sensorGroups?.find((g) => g.id === t.group)?.words ?? { active: 'on', inactive: 'off' };
                return (
                  <select className="form-select form-select-sm" aria-label="Becomes" value={t.becomes} onChange={(e) => onChange({ ...t, becomes: e.target.value as 'none' | 'some' | 'all' })} style={{ width: 'auto' }}>
                    <option value="none">all {w.inactive}</option>
                    <option value="some">some {w.active}</option>
                    <option value="all">all {w.active}</option>
                  </select>
                );
              })()}
            </>
          ) : (
            <>
              <select className="form-select form-select-sm" aria-label="Check" value={t.check} onChange={(e) => onChange({ ...t, check: Number(e.target.value) })} style={{ width: 'auto' }}>
                {(choices.checks ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              becomes
              <select className="form-select form-select-sm" aria-label="Becomes" value={String(t.becomes)} onChange={(e) => onChange({ ...t, becomes: e.target.value === 'true' })} style={{ width: 'auto' }}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </>
          )}
          <label className="d-flex align-items-center gap-1 small mb-0">
            <input
              className="form-check-input mt-0"
              type="checkbox"
              checked={t.forMinutes !== undefined}
              onChange={(e) => {
                const { forMinutes: _drop, ...rest } = t;
                onChange(e.target.checked ? { ...t, forMinutes: 5 } : rest);
              }}
            />
            and stays so for
          </label>
          {t.forMinutes !== undefined && (
            <span className="d-flex align-items-center gap-1">
              <input className="form-control form-control-sm" type="number" min={1} max={1440} aria-label="Minutes" value={t.forMinutes} onChange={(e) => onChange({ ...t, forMinutes: Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || 1))) })} style={{ width: '5rem' }} />
              min
            </span>
          )}
        </>
      )}
      {t.type === 'event' && <input className="form-control form-control-sm" aria-label="Event name" placeholder="event name" value={t.name} maxLength={60} onChange={(e) => onChange({ ...t, name: e.target.value })} />}
    </div>
  );
}

function StateTrigger({ t, choices, onChange }: { t: Extract<Trigger, { type: 'state' }>; choices: Choices; onChange: (t: Trigger) => void }) {
  const devices = choices.devices.filter((d) => readable(d).length > 0);
  const device = choices.devices.find((d) => d.ieee === t.device);
  const props = readable(device);
  const p = props.find((x) => x.property === t.property);
  const mode = t.to !== undefined ? 'to' : t.above !== undefined ? 'above' : t.below !== undefined ? 'below' : 'any';
  // "For N minutes" (0014) stays when the value or threshold changes.
  const base = { type: 'state' as const, device: t.device, property: t.property, ...(t.forMinutes !== undefined ? { forMinutes: t.forMinutes } : {}) };
  const { forMinutes: _drop, ...withoutFor } = t;
  return (
    <>
      <DeviceSelect all={choices.devices} devices={devices} value={t.device} onChange={(ieee) => onChange({ type: 'state', device: ieee, property: readable(choices.devices.find((d) => d.ieee === ieee))[0]?.property ?? '' })} />
      <select className="form-select form-select-sm" aria-label="Property" value={t.property} onChange={(e) => onChange({ ...base, property: e.target.value })}>
        {props.map((x) => (
          <option key={x.property} value={x.property}>
            {propertyLabel(x, device?.labels)}
          </option>
        ))}
      </select>
      <select className="form-select form-select-sm"
        aria-label="Change"
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          if (m === 'to') onChange({ ...base, to: p ? (valueChoices(p).filter((v) => v !== p.valueToggle)[0] ?? 0) : 'ON' });
          else if (m === 'above') onChange({ ...base, above: 0 });
          else if (m === 'below') onChange({ ...base, below: 0 });
          else onChange({ type: 'state', device: t.device, property: t.property });
        }}
      >
        <option value="to">becomes</option>
        {p?.type === 'numeric' && <option value="above">rises above</option>}
        {p?.type === 'numeric' && <option value="below">falls below</option>}
        <option value="any">changes</option>
      </select>
      {mode === 'to' && p && <ValueInput prop={{ ...p, valueToggle: undefined }} value={t.to} onChange={(v) => onChange({ ...base, to: v })} />}
      {mode === 'above' && <input className="form-control form-control-sm" type="number" value={t.above} onChange={(e) => onChange({ ...base, above: Number(e.target.value) })} style={{ width: '6rem' }} />}
      {mode === 'below' && <input className="form-control form-control-sm" type="number" value={t.below} onChange={(e) => onChange({ ...base, below: Number(e.target.value) })} style={{ width: '6rem' }} />}
      {mode !== 'any' && (
        <label className="d-flex align-items-center gap-1 small mb-0">
          <input className="form-check-input mt-0" type="checkbox" checked={t.forMinutes !== undefined} onChange={(e) => onChange(e.target.checked ? { ...t, forMinutes: 5 } : withoutFor)} />
          and stays so for
        </label>
      )}
      {mode !== 'any' && t.forMinutes !== undefined && (
        <span className="d-flex align-items-center gap-1">
          <input
            className="form-control form-control-sm"
            type="number"
            min={1}
            max={1440}
            aria-label="Minutes"
            value={t.forMinutes}
            onChange={(e) => onChange({ ...t, forMinutes: Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
            style={{ width: '5rem' }}
          />
          min
        </span>
      )}
    </>
  );
}


/** "± N min at random": a different time each day, the same all day, so a home looks lived in (0010). */
function RandomOffset({ t, onChange }: { t: Extract<Trigger, { type: 'time' | 'sun' }>; onChange: (t: Trigger) => void }) {
  const { random, ...without } = t;
  return (
    <>
      <label className="d-flex align-items-center gap-1 small mb-0" title="Each day a different time, up to this many minutes earlier or later">
        <input className="form-check-input mt-0" type="checkbox" checked={random !== undefined} onChange={(e) => onChange(e.target.checked ? { ...t, random: 15 } : (without as Trigger))} />
        at random ±
      </label>
      {random !== undefined && (
        <span className="d-flex align-items-center gap-1">
          <input
            className="form-control form-control-sm"
            type="number"
            min={1}
            max={60}
            aria-label="Random minutes"
            value={random}
            onChange={(e) => onChange({ ...t, random: Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
            style={{ width: '4.5rem' }}
          />
          min
        </span>
      )}
    </>
  );
}
