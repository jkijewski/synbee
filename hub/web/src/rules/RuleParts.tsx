import { valueChoices, type Choices, type ChoiceDevice, type Condition, type RuleStep, type Trigger, type Weekday } from '../api';
import { defaultValue } from '../Values';
import { ItemLink } from '../Related';
import { ALL_DAYS, DAYS } from './common';
import { byRoom } from '../byRoom';

// Shared pieces of the rule editors: a removable item, defaults for new parts, device and weekday pickers.
export function Item({ children, onRemove, title }: { children: React.ReactNode; onRemove: () => void; title?: string }) {
  return (
    <div className="step">
      <div className="line">
        {title && <strong style={{ marginRight: 'auto' }}>{title}</strong>}
        <button className="btn btn-outline-secondary btn-sm small-button" style={{ marginLeft: 'auto' }} onClick={onRemove} aria-label="Remove">
          Remove
        </button>
      </div>
      {children}
    </div>
  );
}

export const withEvents = (c: Choices) => c.devices.filter((d) => d.events.length > 0);
export const readable = (d: ChoiceDevice | undefined) => d?.properties.filter((p) => p.readable && p.property !== 'action') ?? [];

export function defaultTrigger(c: Choices): Trigger {
  const d = withEvents(c)[0];
  const e = d?.events[0];
  if (d && e) return e.button ? { type: 'button', device: d.ieee, button: e.button, press: e.press } : { type: 'button', device: d.ieee, raw: e.raw };
  return { type: 'time', at: '22:00', days: ALL_DAYS };
}
export function defaultCondition(c: Choices): Condition {
  // Prefer an on/off property, the most common condition.
  const d = c.devices.find((x) => readable(x).some((p) => p.type === 'binary')) ?? c.devices.find((x) => readable(x).length > 0);
  const p = readable(d).find((x) => x.type === 'binary') ?? readable(d)[0];
  if (d && p) return { type: 'state', device: d.ieee, property: p.property, op: 'eq', value: valueChoices(p)[0] ?? 0 };
  return { type: 'time', from: '18:00', to: '23:00' };
}
export function defaultStep(c: Choices): RuleStep {
  const d = c.devices.find((x) => x.status === 'joined' && x.properties.some((p) => p.writable));
  const p = d?.properties.find((x) => x.writable);
  return d && p ? { type: 'device', device: d.ieee, values: { [p.property]: defaultValue(p) } } : { type: 'wait', seconds: 60 };
}

export function DeviceSelect({ devices, all, value, onChange }: { devices: ChoiceDevice[]; all?: ChoiceDevice[]; value: string; onChange: (ieee: string) => void }) {
  // The chosen device may not be in this list: imported and not paired yet (no capabilities), or really removed.
  const known = (all ?? devices).find((d) => d.ieee === value);
  const missing = known ? `${known.name} (${known.status === 'pending' ? 'waiting to pair' : 'cannot do this'})` : `${value} (gone)`;
  return (
    <>
    {value && (
      <ItemLink kind="device" id={value}>
        <span className="icon" title="Open this device">open_in_new</span>
      </ItemLink>
    )}
    <select className="form-select form-select-sm" aria-label="Device" value={value} onChange={(e) => onChange(e.target.value)}>
      {!devices.some((d) => d.ieee === value) && <option value={value}>{missing}</option>}
      {byRoom(devices).map(([room, list]) => (
        <optgroup key={room} label={room}>
          {list.map((d) => (
            <option key={d.ieee} value={d.ieee}>
              {d.name}
              {d.status === 'pending' ? ' (not moved yet)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
    </>
  );
}

export function Days({ days, onChange }: { days: Weekday[]; onChange: (d: Weekday[]) => void }) {
  return (
    <span className="line">
      {DAYS.map(([d, name]) => (
        <label key={d} className="line day">
          <input className="form-check-input" type="checkbox" checked={days.includes(d)} onChange={(e) => onChange(e.target.checked ? [...days, d].sort() : days.filter((x) => x !== d))} />
          {name}
        </label>
      ))}
    </span>
  );
}

