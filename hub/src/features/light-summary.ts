import type { ExposedProperty } from '../exposes.js';

// A light's current look in a few words, for the device page, the device list and light groups: "On · red · 29 %",
// "On · warm white 2800 K · 100 %" or "Off". Pure: shared by the hub and the web UI.

export type LightMode = 'color' | 'white';

export interface LightSummary {
  on: boolean | null;
  /** Colour or white, when known. */
  mode: LightMode | null;
  /** The words shown, e.g. "red · 29 %". Empty when off or unknown. */
  text: string;
  /** A CSS colour for a swatch: the colour, or a warm-to-cold white. */
  swatch: string | null;
}

const COLOUR_NAMES: Array<[number, string]> = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [160, 'green'],
  [200, 'cyan'],
  [260, 'blue'],
  [290, 'purple'],
  [335, 'pink'],
  [360, 'red'],
];

export function colourName(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return COLOUR_NAMES.find(([upTo]) => h < upTo)?.[1] ?? 'red';
}

function hsToHex(hue: number, saturation: number): string {
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function hexToHue(hex: string): { hue: number; saturation: number } | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d > 0) hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { hue: (hue + 360) % 360, saturation: max === 0 ? 0 : (d / max) * 100 };
}

function whiteWords(mired: number): { words: string; swatch: string } {
  const kelvin = Math.round(1_000_000 / mired / 100) * 100;
  const tone = kelvin <= 3300 ? 'warm white' : kelvin >= 5000 ? 'cold white' : 'neutral white';
  const swatch = kelvin <= 3300 ? '#ffc27a' : kelvin >= 5000 ? '#dfe9ff' : '#fff1d6';
  return { words: `${tone} ${kelvin} K`, swatch };
}

const percent = (raw: unknown, max = 254) => (typeof raw === 'number' ? `${Math.round((raw / max) * 100)} %` : null);

/** Whether a device is a light worth summarising: it can be switched and has brightness, colour or white. */
export function isLight(props: ExposedProperty[]): boolean {
  return props.some((p) => p.property === 'state') && props.some((p) => ['brightness', 'color', 'color_temp'].includes(p.property));
}

/**
 * The summary of a light from its reported state. `mode` is what the hub knows the light shows (from its colour mode
 * report, or from the last look the hub sent); without it, the reported `color_mode` decides.
 */
export function lightSummary(props: ExposedProperty[], state: Record<string, unknown>, mode: LightMode | null): LightSummary {
  const stateProp = props.find((p) => p.property === 'state');
  const on = state.state === undefined ? null : state.state === (stateProp?.valueOn ?? 'ON');
  const known: LightMode | null =
    mode ?? (state.color_mode === 'color_temp' ? 'white' : state.color_mode === 'hs' || state.color_mode === 'xy' ? 'color' : null);
  const hasColour = props.some((p) => p.property === 'color');
  const hasWhite = props.some((p) => p.property === 'color_temp');
  const separateWhite = props.some((p) => p.property === 'white_brightness');
  const resolved: LightMode | null = known ?? (hasColour && !hasWhite ? 'color' : !hasColour && hasWhite ? 'white' : null);
  if (on !== true) return { on, mode: resolved, text: '', swatch: null };

  const parts: string[] = [];
  let swatch: string | null = null;
  if (resolved === 'color') {
    const c = (state.color ?? {}) as Record<string, unknown>;
    const hs =
      typeof c.hue === 'number' ? { hue: c.hue, saturation: typeof c.saturation === 'number' ? c.saturation : 100 } : typeof c.hex === 'string' ? hexToHue(c.hex) : null;
    if (hs) {
      parts.push(hs.saturation < 15 ? 'white (colour)' : colourName(hs.hue));
      swatch = hsToHex(hs.hue, hs.saturation);
    } else {
      parts.push('colour');
    }
    const pct = percent(state.brightness);
    if (pct) parts.push(pct);
  } else if (resolved === 'white') {
    if (typeof state.color_temp === 'number' && state.color_temp > 0) {
      const w = whiteWords(state.color_temp);
      parts.push(w.words);
      swatch = w.swatch;
    } else {
      parts.push('white');
    }
    const pct = percent(separateWhite ? state.white_brightness : state.brightness);
    if (pct) parts.push(pct);
  } else {
    const pct = percent(state.brightness);
    if (pct) parts.push(pct);
  }
  return { on, mode: resolved, text: parts.join(' · '), swatch };
}

/** "On · red · 29 %", "Off" or "" when the state isn't known. */
export function summaryWords(s: LightSummary): string {
  if (s.on === null) return '';
  if (!s.on) return 'Off';
  return s.text ? `On · ${s.text}` : 'On';
}
