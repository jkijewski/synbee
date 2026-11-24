import type { FeatureModule } from './types.js';

const max = (p: { max?: number }) => p.max ?? 254;

// Brightness, shown in % of the device's range (Zigbee2MQTT uses 0–254).
export const brightness: FeatureModule = {
  id: 'brightness',
  label: 'Brightness',
  unit: '%',
  matches: (p) => p.type === 'numeric' && /^brightness(_.+)?$/.test(p.property),
  toDisplay: (raw, p) => Math.round((raw / max(p)) * 100),
  fromDisplay: (pct, p) => Math.round((Math.min(100, Math.max(0, pct)) / 100) * max(p)),
  // Bulbs round and fade; 2 % of the range is close enough.
  tolerance: (p) => Math.ceil(max(p) * 0.02),
  relative: { key: 'brightness_step', toRaw: (pct, p) => Math.round((pct / 100) * max(p)) },
  fades: true,
  operators: ['gt', 'lt', 'between', 'eq'],
  tuya: [
    {
      code: 'bright_value',
      translate: (_c, v) => (typeof v === 'number' ? { brightness: Math.max(1, Math.round((Math.min(1000, v) / 1000) * 254)) } : null),
    },
  ],
};

/** The separate white channel's brightness of RGB+CCT LED controllers such as the Skydance WZ5, also in %. */
export const whiteBrightness: FeatureModule = {
  id: 'white_brightness',
  label: 'White brightness',
  unit: '%',
  matches: (p) => p.type === 'numeric' && p.property === 'white_brightness',
  toDisplay: brightness.toDisplay,
  fromDisplay: brightness.fromDisplay,
  tolerance: brightness.tolerance,
  operators: ['gt', 'lt', 'between', 'eq'],
};
