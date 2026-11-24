import type { FeatureModule } from './types.js';

// White colour temperature. Zigbee2MQTT uses mireds; people think in Kelvin (warm 2200 K … cold 6500 K).
const kelvin = (mired: number) => Math.round(1_000_000 / Math.max(1, mired) / 50) * 50;
const mired = (k: number) => Math.round(1_000_000 / Math.max(1000, k));

export const colorTemp: FeatureModule = {
  id: 'color_temp',
  label: 'White temperature',
  unit: 'K',
  matches: (p) => p.type === 'numeric' && /^color_temp(_.+)?$/.test(p.property) && !p.property.includes('startup'),
  toDisplay: (raw) => kelvin(raw),
  fromDisplay: (k) => mired(k),
  tolerance: () => 5,
  relative: { key: 'color_temp_step', toRaw: (delta) => Math.round(delta) },
  fades: true,
  operators: ['gt', 'lt', 'between', 'eq'],
  tuya: [
    {
      code: 'temp_value',
      translate(_c, v, notes) {
        if (typeof v !== 'number') return null;
        notes.push('White temperature scaled across 153 to 500 mireds; check it by eye once the bulbs have joined.');
        return { color_temp: Math.round(500 - (Math.min(1000, Math.max(0, v)) / 1000) * (500 - 153)) };
      },
    },
    {
      code: 'work_mode',
      translate(_c, v, notes) {
        if (v !== 'white') return null;
        notes.push("Tuya's white mode has no temperature in the scene; it became a neutral white (250 mireds).");
        return { color_temp: 250 };
      },
    },
  ],
};
