import { featureFor, wordFor as hubWordFor, wordValue } from '../../../src/features/index.js';
import type { Property } from '../api';
import type { FeatureUI } from './types';

// Yes/no features with words of their own (0008): Open / Closed, Wet / Dry, Locked / Unlocked. The badge turns red
// for an alarm and yellow for a warning, as the hub module decides.

const wordFor = (prop: Property, value: unknown): string | null => hubWordFor(prop, value);

export const wordsUI: FeatureUI = {
  Display: ({ prop, value }) => {
    const word = wordFor(prop, value);
    if (word === null) return <span className="muted">unknown</span>;
    const level = featureFor(prop).attention?.(value, prop) ?? null;
    return <span className={`badge ${level === 'alarm' ? 'text-bg-danger' : level === 'warning' ? 'text-bg-warning' : 'text-bg-light border'}`}>{word}</span>;
  },
  Control: ({ prop, onSend }) => {
    const words = featureFor(prop).words!;
    return (
      <div className="btn-group btn-group-sm" role="group">
        <button className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: wordValue(prop, 'on') })}>
          {words.on}
        </button>
        <button className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: wordValue(prop, 'off') })}>
          {words.off}
        </button>
      </div>
    );
  },
  Editor: ({ prop, value, onChange }) => {
    const words = featureFor(prop).words!;
    const on = wordValue(prop, 'on');
    const off = wordValue(prop, 'off');
    return (
      <select className="form-select form-select-sm" aria-label="Value" value={value === on ? 'on' : value === off ? 'off' : ''} onChange={(e) => onChange(e.target.value === 'on' ? on : off)}>
        <option value="" disabled>
          choose…
        </option>
        <option value="on">{words.on}</option>
        <option value="off">{words.off}</option>
      </select>
    );
  },
};
