import type { FeatureModule } from './types.js';

// Read-only measurements. Each is a few lines; this is where e.g. CO2 or illuminance would be added.
const reading = (id: string, label: string, property: string, unit: string): FeatureModule => ({
  id,
  label,
  unit,
  readOnly: true,
  matches: (p) => p.type === 'numeric' && p.property === property,
  operators: ['gt', 'lt', 'between'],
  tolerance: () => 0,
});

export const temperature = reading('temperature', 'Temperature', 'temperature', '°C');
export const humidity = reading('humidity', 'Humidity', 'humidity', '%');
/** Battery level; 15 % or less needs a new battery soon. */
export const battery: FeatureModule = { ...reading('battery', 'Battery', 'battery', '%'), attention: (v) => (typeof v === 'number' && v <= 15 ? 'warning' : null) };
export const power = reading('power', 'Power', 'power', 'W');
export const energy = reading('energy', 'Energy', 'energy', 'kWh');
export const voltage = reading('voltage', 'Voltage', 'voltage', 'V');
export const current = reading('current', 'Current', 'current', 'A');
export const pressure = reading('pressure', 'Pressure', 'pressure', 'hPa');
export const co2 = reading('co2', 'CO₂', 'co2', 'ppm');
/** Some sensors report illuminance_lux next to a raw illuminance; both are shown in lux. */
export const illuminance: FeatureModule = { ...reading('illuminance', 'Light level', 'illuminance', 'lx'), matches: (p) => p.type === 'numeric' && /^illuminance(_lux)?$/.test(p.property) };
