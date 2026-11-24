// Sample Zigbee2MQTT device definitions for development without a coordinator.
// IEEE addresses match the Tuya node IDs of the test fixtures. Models and exposes are illustrative:
// the real values come from Zigbee2MQTT on hardware.

export interface SimDevice {
  ieee_address: string;
  friendly_name: string;
  type: 'Router' | 'EndDevice' | 'Coordinator';
  supported: boolean;
  interview_completed: boolean;
  model_id?: string;
  manufacturer?: string;
  definition: {
    model: string;
    vendor: string;
    description: string;
    exposes: unknown[];
    options: unknown[];
  } | null;
}

const onOff = (endpoint: string) => ({
  type: 'switch',
  endpoint,
  features: [
    {
      type: 'binary',
      name: 'state',
      property: `state_${endpoint}`,
      access: 7,
      value_on: 'ON',
      value_off: 'OFF',
      value_toggle: 'TOGGLE',
    },
  ],
});

export const sampleDevices: SimDevice[] = [
  {
    ieee_address: '0x00124b0000000001',
    friendly_name: 'Coordinator',
    type: 'Coordinator',
    supported: true,
    interview_completed: true,
    definition: null,
  },
  {
    ieee_address: '0xa4c1380000000001',
    friendly_name: 'biurko robocze',
    type: 'Router',
    supported: true,
    interview_completed: true,
    definition: {
      model: 'SIM-SWITCH-3CH',
      vendor: 'Simulated',
      description: 'Simulated 3-channel switch',
      exposes: [
        onOff('l1'),
        onOff('l2'),
        onOff('l3'),
        {
          type: 'enum',
          name: 'power_on_behavior',
          property: 'power_on_behavior',
          access: 7,
          values: ['off', 'on', 'previous'],
        },
      ],
      options: [],
    },
  },
  {
    ieee_address: '0xa4c1380000000002',
    friendly_name: 'Wireless Switch',
    type: 'EndDevice',
    supported: true,
    interview_completed: true,
    definition: {
      model: 'SIM-REMOTE-3BTN',
      vendor: 'Simulated',
      description: 'Simulated 3-button remote',
      exposes: [
        {
          type: 'enum',
          name: 'action',
          property: 'action',
          access: 1,
          values: ['1_single', '1_double', '1_hold', '2_single', '2_double', '2_hold', '3_single', '3_double', '3_hold'],
        },
        { type: 'numeric', name: 'battery', property: 'battery', access: 1, unit: '%', value_min: 0, value_max: 100 },
      ],
      options: [],
    },
  },
  {
    ieee_address: '0x1234567890abcdef',
    friendly_name: '0x1234567890abcdef',
    type: 'EndDevice',
    supported: false,
    interview_completed: true,
    model_id: 'TS0601',
    manufacturer: '_TZE200_simulated',
    definition: null,
  },
];

/** A simulated RGB+CCT bulb, shaped like Zigbee2MQTT's TS0505B definition. */
export function sampleBulb(ieee: string, name: string): SimDevice {
  return {
    ieee_address: ieee,
    friendly_name: name,
    type: 'Router',
    supported: true,
    interview_completed: true,
    definition: {
      model: 'SIM-TS0505B',
      vendor: 'Simulated',
      description: 'Simulated RGB+CCT bulb',
      exposes: [
        {
          type: 'light',
          features: [
            { type: 'binary', name: 'state', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF', value_toggle: 'TOGGLE' },
            { type: 'numeric', name: 'brightness', property: 'brightness', access: 7, value_min: 0, value_max: 254 },
            { type: 'numeric', name: 'color_temp', property: 'color_temp', access: 7, value_min: 153, value_max: 500, unit: 'mired' },
            {
              type: 'composite',
              name: 'color_xy',
              property: 'color',
              access: 7,
              features: [
                { type: 'numeric', name: 'x', property: 'x', access: 7 },
                { type: 'numeric', name: 'y', property: 'y', access: 7 },
              ],
            },
          ],
        },
      ],
      options: [],
    },
  };
}

/** Three living-room bulbs, for development with lights. */
export const sampleBulbs: SimDevice[] = [
  sampleBulb('0x60a423fffe000001', 'salon_gora'),
  sampleBulb('0x60a423fffe000002', 'salon_polka'),
  sampleBulb('0x60a423fffe000003', 'salon_regal'),
];

const binary = (property: string, extra: object = {}) => ({ type: 'binary', name: property, property, access: 1, value_on: true, value_off: false, ...extra });
const num = (property: string, extra: object = {}) => ({ type: 'numeric', name: property, property, access: 1, ...extra });
const device = (ieee: string, name: string, model: string, description: string, exposes: unknown[], type: SimDevice['type'] = 'EndDevice'): SimDevice => ({
  ieee_address: ieee,
  friendly_name: name,
  type,
  supported: true,
  interview_completed: true,
  definition: { model, vendor: 'Simulated', description, exposes, options: [] },
});

/** Sensors, a lock, a plug and a radiator valve with settings and diagnostics, for working on device features (0008). */
export const sampleSensors: SimDevice[] = [
  device('0x00158d0000000101', 'front_door', 'SIM-CONTACT', 'Door and window sensor', [
    binary('contact'),
    num('battery', { unit: '%', value_min: 0, value_max: 100, category: 'diagnostic' }),
    num('voltage', { unit: 'mV', category: 'diagnostic' }),
    num('linkquality', { unit: 'lqi', category: 'diagnostic' }),
  ]),
  device('0x00158d0000000102', 'bathroom_leak', 'SIM-LEAK', 'Water leak sensor', [
    binary('water_leak'),
    binary('battery_low', { category: 'diagnostic' }),
    binary('tamper'),
    num('battery', { unit: '%', value_min: 0, value_max: 100, category: 'diagnostic' }),
  ]),
  device('0x00158d0000000103', 'hall_motion', 'SIM-MOTION', 'Motion sensor', [
    binary('occupancy'),
    num('illuminance_lux', { unit: 'lx' }),
    { type: 'enum', name: 'sensitivity', property: 'sensitivity', access: 7, values: ['low', 'medium', 'high'], category: 'config' },
    num('battery', { unit: '%', value_min: 0, value_max: 100, category: 'diagnostic' }),
  ]),
  device('0x00158d0000000104', 'front_lock', 'SIM-LOCK', 'Door lock', [
    { type: 'lock', features: [{ type: 'binary', name: 'state', property: 'state', access: 7, value_on: 'LOCK', value_off: 'UNLOCK' }, { type: 'enum', name: 'lock_state', property: 'lock_state', access: 1, values: ['not_fully_locked', 'locked', 'unlocked'] }] },
    num('auto_relock_time', { access: 7, unit: 's', value_min: 0, value_max: 3600, category: 'config' }),
    num('battery', { unit: '%', value_min: 0, value_max: 100, category: 'diagnostic' }),
  ]),
  device('0x00158d0000000105', 'radiator', 'SIM-TRV', 'Radiator valve', [
    { type: 'climate', features: [num('local_temperature', { unit: '°C', access: 5 }), num('occupied_heating_setpoint', { access: 7, unit: '°C', value_min: 5, value_max: 30, value_step: 0.5 }), { type: 'enum', name: 'system_mode', property: 'system_mode', access: 7, values: ['off', 'heat'] }] },
    binary('child_lock', { access: 7, value_on: 'LOCK', value_off: 'UNLOCK', category: 'config' }),
    num('local_temperature_calibration', { access: 7, unit: '°C', value_min: -5, value_max: 5, value_step: 0.1, category: 'config' }),
    num('battery', { unit: '%', value_min: 0, value_max: 100, category: 'diagnostic' }),
  ]),
  device(
    '0x00158d0000000106',
    'desk_plug',
    'SIM-PLUG',
    'Plug with energy metering',
    [
      { type: 'switch', features: [{ type: 'binary', name: 'state', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF', value_toggle: 'TOGGLE' }] },
      num('power', { unit: 'W' }),
      num('energy', { unit: 'kWh' }),
      num('voltage', { unit: 'V', category: 'diagnostic' }),
    ],
    'Router',
  ),
  device('0x00158d0000000107', 'living_climate', 'SIM-CLIMATE', 'Temperature and humidity sensor', [num('temperature', { unit: '°C' }), num('humidity', { unit: '%' })]),
];

/** Starting values for the sample sensors: an open door, a leak, a low battery. */
export const sampleSensorStates: Record<string, Record<string, unknown>> = {
  front_door: { contact: false, battery: 87, voltage: 3000, linkquality: 120 },
  bathroom_leak: { water_leak: true, battery_low: false, tamper: false, battery: 64 },
  hall_motion: { occupancy: false, illuminance_lux: 140, sensitivity: 'medium', battery: 11 },
  front_lock: { state: 'LOCK', lock_state: 'locked', auto_relock_time: 30, battery: 71 },
  desk_plug: { state: 'ON', power: 42, energy: 12.5, voltage: 231 },
  living_climate: { temperature: 21.3, humidity: 48 },
  radiator: { local_temperature: 20.5, occupied_heating_setpoint: 21, system_mode: 'heat', child_lock: 'UNLOCK', local_temperature_calibration: 0, battery: 55 },
};

/** A Skydance WZ5 LED controller as Zigbee2MQTT describes it: a Tuya datapoint device (TS0601) with no fade option. */
export function sampleWz5(ieee: string, name: string): SimDevice {
  const bulb = sampleBulb(ieee, name);
  // Like the real one: colour only as hue and saturation, and a separate white channel with its own brightness.
  const light = structuredClone(bulb.definition!.exposes[0]) as { features: Array<Record<string, unknown>> };
  light.features = light.features.map((f) =>
    f.property === 'color'
      ? { type: 'composite', name: 'color_hs', property: 'color', access: 7, features: [{ type: 'numeric', name: 'hue', property: 'hue', access: 7 }, { type: 'numeric', name: 'saturation', property: 'saturation', access: 7 }] }
      : f,
  );
  const exposes = [light, ...bulb.definition!.exposes.slice(1), { type: 'numeric', name: 'white_brightness', property: 'white_brightness', access: 7, value_min: 0, value_max: 254 }];
  return { ...bulb, model_id: 'TS0601', manufacturer: '_TZE200_mde0utnv', definition: { ...bulb.definition!, exposes, model: 'WZ5_rgbcct', vendor: 'Skydance', options: [] } };
}

/** The same bulb with Zigbee2MQTT's usual light options, including fades. */
export function sampleFadingBulb(ieee: string, name: string): SimDevice {
  const bulb = sampleBulb(ieee, name);
  return { ...bulb, definition: { ...bulb.definition!, options: [{ name: 'transition', property: 'transition', type: 'numeric' }] } };
}
