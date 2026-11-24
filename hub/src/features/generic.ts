import type { FeatureModule } from './types.js';

// Fallbacks by Zigbee2MQTT expose type, so a property without its own module still works.

export const genericBinary: FeatureModule = { id: 'binary', label: 'On / off', matches: (p) => p.type === 'binary', operators: ['eq', 'ne'] };
export const genericNumeric: FeatureModule = {
  id: 'numeric',
  label: 'Number',
  matches: (p) => p.type === 'numeric',
  operators: ['eq', 'ne', 'gt', 'lt', 'between'],
  // Devices round; accept 1 % of the range, at least 1.
  tolerance: (p) => (p.min !== undefined && p.max !== undefined ? Math.max(1, (p.max - p.min) / 100) : 1),
};
export const genericEnum: FeatureModule = { id: 'enum', label: 'Choice', matches: (p) => p.type === 'enum', operators: ['eq', 'ne'] };
export const genericOther: FeatureModule = { id: 'other', label: 'Value', matches: () => true, operators: ['eq', 'ne'] };
export const GENERIC = [genericBinary, genericNumeric, genericEnum, genericOther];
