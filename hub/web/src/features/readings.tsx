import { featureFor } from '../../../src/features/index.js';
import { genericUI } from './generic';
import type { FeatureUI } from './types';

// Read-only measurements (temperature, humidity, battery…): shown with their unit; nothing to set.
export const readingUI: FeatureUI = {
  ...genericUI,
  Control: () => null,
  Display: ({ prop, value }) =>
    typeof value === 'number' ? (
      <span>
        {Math.round(value * 10) / 10} {featureFor(prop).unit ?? prop.unit ?? ''}
      </span>
    ) : typeof value === 'string' || typeof value === 'boolean' ? (
      <span>{String(value).replace(/_/g, ' ')}</span>
    ) : (
      <span className="muted">unknown</span>
    ),
};
