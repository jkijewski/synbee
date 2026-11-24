import type { ExposedProperty } from '../exposes.js';
import { checkValue } from '../exposes.js';
import { brightness, whiteBrightness } from './brightness.js';
import { color } from './color.js';
import { colorTemp } from './color-temp.js';
import { GENERIC } from './generic.js';
import { position } from './position.js';
import { battery, co2, current, energy, humidity, illuminance, power, pressure, temperature, voltage } from './sensors.js';
import { state } from './state.js';
import { BINARY_SENSORS } from './binary-sensors.js';
import { childLock, lock, lockState } from './lock.js';
import type { FeatureModule } from './types.js';

export type { FeatureModule, Operator, RelativeChange, TuyaMapping } from './types.js';
export { tuyaColour } from './color.js';

/** All feature modules, most specific first; the generic fallbacks come last. To add a feature, add its module here. */
// Order matters: the first match wins, so the lock comes before the generic on/off state, and the generic ones last.
export const FEATURES: FeatureModule[] = [childLock, lock, lockState, state, brightness, whiteBrightness, colorTemp, color, position, temperature, humidity, battery, power, energy, voltage, current, pressure, co2, illuminance, ...BINARY_SENSORS, ...GENERIC];

export function featureFor(prop: ExposedProperty): FeatureModule {
  return FEATURES.find((f) => f.matches(prop))!;
}

/** Zigbee2MQTT's transition attribute, in seconds, accepted with any value that fades. */
export const TRANSITION = 'transition';
export const DEFAULT_FADE_SECONDS = 1;

/** The relative attributes a device accepts (brightness_step…), mapped to the property they change. */
export function relativeKeys(props: ExposedProperty[]): Map<string, ExposedProperty> {
  const out = new Map<string, ExposedProperty>();
  for (const p of props) {
    const f = featureFor(p);
    if (f.relative && p.writable) out.set(p.endpoint ? `${f.relative.key}_${p.endpoint}` : f.relative.key, p);
  }
  return out;
}

/**
 * Checks values to send against a device's or group's properties. Accepts the properties themselves, their relative
 * attributes and a transition time when something in the values fades. Returns a problem, or null.
 */
export function checkValues(props: ExposedProperty[], values: Record<string, unknown>): string | null {
  const entries = Object.entries(values);
  if (entries.length === 0) return 'Nothing to set';
  const relative = relativeKeys(props);
  for (const [key, value] of entries) {
    if (key === TRANSITION) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3600) return 'Fade time must be 0 to 3600 seconds';
      // Lights fade on, off, brightness and colour changes; devices without a fading feature can't.
      if (!props.some((p) => p.writable && featureFor(p).fades)) return 'This device has no fade; fade time only goes with lights';
      continue;
    }
    if (relative.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return `${key} must be a number other than 0`;
      continue;
    }
    const prop = props.find((p) => p.property === key);
    if (!prop) return `${key} is not something this can do`;
    const problem = checkValue(prop, value);
    if (problem) return problem;
  }
  return null;
}

/** The value a feature's "on" or "off" word stands for: true/false for sensors, else Zigbee2MQTT's on/off values. */
export function wordValue(prop: ExposedProperty, which: 'on' | 'off'): unknown {
  if (featureFor(prop).wordsForTrue) return which === 'on';
  return which === 'on' ? (prop.valueOn ?? true) : (prop.valueOff ?? false);
}

/** A yes/no value in the feature's words (Open / Closed, Wet / Dry), or null when the feature has none. */
export function wordFor(prop: ExposedProperty, value: unknown): string | null {
  const words = featureFor(prop).words;
  if (!words || value === undefined || value === null) return null;
  if (value === wordValue(prop, 'on')) return words.on;
  if (value === wordValue(prop, 'off')) return words.off;
  return String(value);
}

/** Whether a reported value confirms a requested one, allowing for the feature's tolerance. */
export function confirms(prop: ExposedProperty | undefined, wanted: unknown, reported: unknown): boolean {
  if (typeof wanted === 'number' && typeof reported === 'number' && prop) {
    const tol = featureFor(prop).tolerance?.(prop) ?? 0;
    return Math.abs(wanted - reported) <= tol;
  }
  if (wanted && typeof wanted === 'object') return reported !== undefined; // colours come back in another form (xy/hs)
  return wanted === reported;
}

/** Translates one Tuya data point with the first feature that knows it. */
export function translateTuya(code: string, value: unknown, notes: string[]): Record<string, unknown> | null {
  for (const f of FEATURES) {
    for (const m of f.tuya ?? []) {
      if (typeof m.code === 'string' ? m.code === code : m.code.test(code)) {
        const out = m.translate(code, value, notes);
        if (out) return out;
      }
    }
  }
  notes.push(`Not translated: ${code} = ${JSON.stringify(value)}.`);
  return null;
}

/**
 * The properties of a usual colour bulb, for editing imported light steps before their lights have joined
 * (or before their light group is created). Once they join, the real properties replace these.
 */
export const TYPICAL_LIGHT: ExposedProperty[] = [
  { property: 'state', name: 'state', type: 'binary', readable: true, writable: true, valueOn: 'ON', valueOff: 'OFF', valueToggle: 'TOGGLE', gettable: true },
  { property: 'brightness', name: 'brightness', type: 'numeric', readable: true, writable: true, min: 0, max: 254, gettable: true },
  { property: 'color_temp', name: 'color_temp', type: 'numeric', readable: true, writable: true, min: 153, max: 500, unit: 'mired', gettable: true },
  { property: 'color', name: 'color_xy', type: 'composite', readable: true, writable: true, gettable: true },
];

/** Whether these step values only use light settings, so TYPICAL_LIGHT can stand in for missing properties. */
export function onlyLightValues(values: Record<string, unknown>): boolean {
  const keys = Object.keys(values);
  return keys.length > 0 && keys.every((k) => [...TYPICAL_LIGHT.map((p) => p.property), TRANSITION, 'brightness_step', 'color_temp_step'].includes(k));
}

/** Whether a value needs attention: 'alarm' (leak, smoke), 'warning' (low battery, tamper) or null. */
export function attentionFor(prop: ExposedProperty, value: unknown): 'alarm' | 'warning' | null {
  return value === undefined ? null : (featureFor(prop).attention?.(value, prop) ?? null);
}

/** The question to ask before sending these values (unlocking), or null. */
export function confirmationFor(props: ExposedProperty[], values: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(values)) {
    const prop = props.find((p) => p.property === key);
    const question = prop ? featureFor(prop).confirm?.(value, prop) : null;
    if (question) return question;
  }
  return null;
}

/** Settings that only make sense on a lit light. */
const LIGHT_LOOK = ['brightness', 'color', 'color_temp', 'white_brightness'];

/**
 * Choosing a colour, brightness or white temperature means "show me this": add `state: ON` when the light can be
 * switched and the command doesn't say otherwise. Some lights (Skydance WZ5) store a colour sent while off and stay
 * dark; most switch on anyway, so this changes nothing for them.
 */
export function withLightOn(props: ExposedProperty[], values: Record<string, unknown>): Record<string, unknown> {
  const state = props.find((p) => p.property === 'state' && p.writable && p.type === 'binary');
  if (!state || 'state' in values || !Object.keys(values).some((k) => LIGHT_LOOK.includes(k))) return values;
  return { state: state.valueOn ?? 'ON', ...values };
}
