import { hexToHs } from '../device-kinds.js';
import type { ExposedProperty } from '../exposes.js';
import { featureFor, TRANSITION } from './index.js';
import type { LightMode } from './light-summary.js';

// Whether a device shows what an action step sets (0011): for the app's "active" tiles. Pure: from the step's values,
// the device's reported state and, for lights, whether it shows colour or white.

export type StepMatch = 'match' | 'differs' | 'unknown';
export type ActionState = 'active' | 'partly' | 'inactive';

const LIGHT_KEYS = new Set(['brightness', 'white_brightness', 'color', 'color_temp']);
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function reportedHue(c: unknown): number | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (typeof o.hue === 'number') return o.hue;
  if (typeof o.h === 'number') return o.h;
  if (typeof o.hex === 'string') return hexToHs(o.hex)?.hue ?? null;
  return null;
}

function wantedHue(c: unknown): number | null {
  if (typeof c === 'string') return hexToHs(c)?.hue ?? null;
  return reportedHue(c);
}

/** One value: does the reported value show the wanted one, within the feature's tolerance (at least 5 % of its range)? */
function valueMatches(prop: ExposedProperty | undefined, key: string, wanted: unknown, state: Record<string, unknown>, mode: LightMode | null): StepMatch {
  const reported = state[key];
  if (key === 'color') {
    if (mode === 'white') return 'differs';
    const [w, r] = [wantedHue(wanted), reportedHue(reported)];
    if (w === null || r === null) return 'unknown';
    return hueDistance(w, r) <= 10 ? 'match' : 'differs';
  }
  if (key === 'color_temp' && mode === 'color') return 'differs';
  if (reported === undefined) return 'unknown';
  if (typeof wanted === 'number' && typeof reported === 'number') {
    const range = prop?.min !== undefined && prop.max !== undefined ? (prop.max - prop.min) * 0.05 : 0;
    const tol = Math.max(prop ? (featureFor(prop).tolerance?.(prop) ?? 0) : 0, range, key === 'color_temp' ? 10 : 0);
    return Math.abs(wanted - reported) <= tol ? 'match' : 'differs';
  }
  if (typeof wanted === 'string' && typeof reported === 'string') return wanted.toLowerCase() === reported.toLowerCase() ? 'match' : 'differs';
  return wanted === reported ? 'match' : 'differs';
}

/** Whether a device shows what these values set. "Off" matches an off device whatever else the step says. */
export function stepMatches(props: ExposedProperty[], values: Record<string, unknown>, state: Record<string, unknown> | undefined, mode: LightMode | null): StepMatch {
  if (!state || Object.keys(state).length === 0) return 'unknown';
  const byKey = new Map(props.map((p) => [p.property, p]));
  const stateProp = byKey.get('state');
  const onValue = stateProp?.valueOn ?? 'ON';
  const offValue = stateProp?.valueOff ?? 'OFF';
  const on = state.state === undefined ? undefined : String(state.state).toUpperCase() === String(onValue).toUpperCase();
  const keys = Object.keys(values).filter((k) => k !== TRANSITION);
  if (values.state !== undefined) {
    const wanted = String(values.state).toUpperCase();
    if (wanted === 'TOGGLE') return 'unknown';
    if (on === undefined) return 'unknown';
    if (wanted === String(offValue).toUpperCase()) return on ? 'differs' : 'match';
    if (!on) return 'differs';
  } else if (keys.some((k) => LIGHT_KEYS.has(k)) && on === false) {
    return 'differs'; // light settings switch the light on (0009)
  }
  let unknown = false;
  for (const key of keys) {
    if (key === 'state') continue;
    const m = valueMatches(byKey.get(key), key, values[key], state, mode);
    if (m === 'differs') return 'differs';
    if (m === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : 'match';
}

/** An action's state from the matches of all the devices it sets: all match, some, or none; null when none is known. */
export function actionState(matches: StepMatch[]): ActionState | null {
  const known = matches.filter((m) => m !== 'unknown');
  if (known.length === 0) return null;
  if (known.every((m) => m === 'match')) return known.length === matches.length ? 'active' : 'partly';
  return known.some((m) => m === 'match') ? 'partly' : 'inactive';
}
