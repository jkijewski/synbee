import { genericUI } from './generic';
import type { FeatureUI } from './types';

// On/off: the generic binary control, with the state shown as a coloured badge.
export const stateUI: FeatureUI = {
  ...genericUI,
  Display: ({ value }) =>
    value === undefined ? (
      <span className="muted">unknown</span>
    ) : (
      <span className={`badge ${value === 'ON' ? 'text-bg-warning' : 'text-bg-secondary'}`}>{value === 'ON' ? 'on' : value === 'OFF' ? 'off' : String(value)}</span>
    ),
};
