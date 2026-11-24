import { valueChoices } from '../api';
import type { FeatureUI } from './types';

// Fallback controls by expose type, for properties without their own module.

export const genericUI: FeatureUI = {
  Control: ({ prop, value, onSend }) => {
    if (prop.type === 'binary') {
      return (
        <div className="btn-group btn-group-sm" role="group">
          <button className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: prop.valueOn })}>
            On
          </button>
          <button className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: prop.valueOff })}>
            Off
          </button>
          {prop.valueToggle !== undefined && (
            <button className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: prop.valueToggle })}>
              Toggle
            </button>
          )}
        </div>
      );
    }
    if (prop.type === 'enum') {
      return (
        <select className="form-select form-select-sm" value={typeof value === 'string' ? value : ''} onChange={(e) => void onSend({ [prop.property]: e.target.value })}>
          <option value="" disabled>
            choose…
          </option>
          {(prop.values ?? []).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    }
    if (prop.type === 'numeric') {
      return (
        <input
          className="form-control form-control-sm"
          type="number"
          min={prop.min}
          max={prop.max}
          step={prop.step ?? 'any'}
          defaultValue={typeof value === 'number' ? value : ''}
          onKeyDown={(e) => e.key === 'Enter' && void onSend({ [prop.property]: Number((e.target as HTMLInputElement).value) })}
          onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== value && void onSend({ [prop.property]: Number(e.target.value) })}
          style={{ width: '8rem' }}
        />
      );
    }
    return null;
  },
  Editor: ({ prop, value, onChange }) => {
    if (prop.type === 'numeric') {
      return (
        <input
          className="form-control form-control-sm"
          aria-label="Value"
          type="number"
          min={prop.min}
          max={prop.max}
          step={prop.step ?? 'any'}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          style={{ width: '7rem' }}
        />
      );
    }
    const choices = valueChoices(prop);
    return (
      <select className="form-select form-select-sm" aria-label="Value" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(choices.find((c) => String(c) === e.target.value))}>
        <option value="" disabled>
          choose…
        </option>
        {choices.map((c) => (
          <option key={String(c)}>{String(c)}</option>
        ))}
      </select>
    );
  },
  Display: ({ prop, value }) =>
    value === undefined ? <span className="muted">unknown</span> : <span>{`${typeof value === 'object' ? JSON.stringify(value) : String(value)}${prop.unit ? ` ${prop.unit}` : ''}`}</span>,
};
