// Device icons: Material Symbols names (bundled with the web UI). The hub picks one from what the device can do,
// the Tuya import gives one for devices that haven't moved yet, and the owner can choose another.

export const ICON_NAME = /^[a-z0-9_]{1,40}$/;
export const UNKNOWN_ICON = 'question_mark';

/** Suggestions offered first in the icon picker. */
export const SUGGESTED_ICONS = [
  'lightbulb', 'light', 'light_group', 'wall_lamp', 'floor_lamp', 'toggle_on', 'switch', 'smart_outlet', 'outlet', 'power',
  'settings_remote', 'remote_gen', 'sensors', 'motion_sensor_active', 'sensor_door', 'window_sensor', 'thermometer',
  'humidity_percentage', 'water_damage', 'detector_smoke', 'co2', 'blinds', 'roller_shades', 'thermostat', 'mode_fan',
  'ac_unit', 'valve', 'lock', 'doorbell', 'siren', 'bolt', UNKNOWN_ICON,
];

interface Feature {
  type?: unknown;
  property?: unknown;
  name?: unknown;
  features?: unknown;
}

function collect(exposes: unknown[] | undefined): { types: Set<string>; props: Set<string>; switches: number } {
  const types = new Set<string>();
  const props = new Set<string>();
  let switches = 0;
  const walk = (items: unknown[]) => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Feature;
      if (typeof e.type === 'string') types.add(e.type);
      if (e.type === 'switch') switches++;
      if (typeof e.property === 'string') props.add(e.property);
      if (Array.isArray(e.features)) walk(e.features);
    }
  };
  walk(exposes ?? []);
  return { types, props, switches };
}

/** The icon for a device, from its Zigbee2MQTT definition; null when it has none. */
export function autoIcon(definition: { exposes?: unknown[] } | null | undefined): string | null {
  if (!definition) return null;
  const { types, props, switches } = collect(definition.exposes);
  if (types.has('light')) return 'lightbulb';
  if (types.has('cover')) return 'blinds';
  if (types.has('lock')) return 'lock';
  if (types.has('climate')) return 'thermostat';
  if (types.has('fan')) return 'mode_fan';
  if (props.has('action')) return 'settings_remote';
  if (switches > 0) return props.has('power') || props.has('energy') ? 'smart_outlet' : 'toggle_on';
  if (props.has('smoke')) return 'detector_smoke';
  if (props.has('water_leak')) return 'water_damage';
  if (props.has('contact')) return 'sensor_door';
  if (props.has('occupancy') || props.has('presence')) return 'motion_sensor_active';
  if (props.has('co2')) return 'co2';
  if (props.has('temperature')) return 'thermometer';
  if (props.has('humidity')) return 'humidity_percentage';
  return 'sensors';
}

// Tuya product categories, for devices imported before they join.
const TUYA: Record<string, string> = {
  dj: 'lightbulb', dd: 'lightbulb', dc: 'lightbulb', fwd: 'lightbulb', xdd: 'lightbulb', tgq: 'lightbulb', tgkg: 'lightbulb',
  kg: 'toggle_on', tdq: 'toggle_on', pc: 'smart_outlet', cz: 'smart_outlet',
  wxkg: 'settings_remote', cl: 'blinds', clkg: 'blinds', mcs: 'sensor_door', pir: 'motion_sensor_active',
  wsdcg: 'thermometer', ywbj: 'detector_smoke', sj: 'water_damage', wk: 'thermostat', wkf: 'thermostat', ms: 'lock',
};

export function tuyaIcon(category: string | undefined): string | null {
  return (category && TUYA[category]) || null;
}
