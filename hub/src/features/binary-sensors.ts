import type { FeatureModule } from './types.js';

// Yes/no sensors (contact, motion, leak, smoke…), shown with words that say what they mean, and flagged when they
// need attention (0008). Zigbee2MQTT reports them as true/false; `on` below is the word for true, whatever
// Zigbee2MQTT declares as the "on" value (for contact sensors that is false).
const sensor = (id: string, label: string, property: string, on: string, off: string, attention?: 'alarm' | 'warning'): FeatureModule => ({
  id,
  label,
  readOnly: true,
  words: { on, off },
  wordsForTrue: true,
  matches: (p) => p.type === 'binary' && p.property === property,
  operators: ['eq', 'ne'],
  ...(attention ? { attention: (value: unknown) => (value === true ? attention : null) } : {}),
});

/** A contact sensor reports true when the magnet is near: the door or window is closed. */
export const contact = sensor('contact', 'Door / window', 'contact', 'Closed', 'Open');
export const occupancy = sensor('occupancy', 'Motion', 'occupancy', 'Motion', 'Clear');
export const presence = sensor('presence', 'Presence', 'presence', 'Someone there', 'Nobody');
export const waterLeak = sensor('water_leak', 'Water leak', 'water_leak', 'Wet', 'Dry', 'alarm');
export const smoke = sensor('smoke', 'Smoke', 'smoke', 'Smoke', 'Clear', 'alarm');
export const carbonMonoxide = sensor('carbon_monoxide', 'Carbon monoxide', 'carbon_monoxide', 'Detected', 'Clear', 'alarm');
export const gas = sensor('gas', 'Gas', 'gas', 'Detected', 'Clear', 'alarm');
export const tamper = sensor('tamper', 'Tamper', 'tamper', 'Tampered', 'OK', 'warning');
export const batteryLow = sensor('battery_low', 'Battery', 'battery_low', 'Low', 'OK', 'warning');
export const vibration = sensor('vibration', 'Vibration', 'vibration', 'Vibration', 'Still');

export const BINARY_SENSORS = [contact, occupancy, presence, waterLeak, smoke, carbonMonoxide, gas, tamper, batteryLow, vibration];
