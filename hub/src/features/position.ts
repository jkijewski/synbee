import type { FeatureModule } from './types.js';

// Blind or curtain position, 0 % closed to 100 % open.
export const position: FeatureModule = {
  id: 'position',
  label: 'Position',
  unit: '%',
  matches: (p) => p.type === 'numeric' && p.property === 'position',
  tolerance: () => 2,
  operators: ['gt', 'lt', 'between', 'eq'],
};
