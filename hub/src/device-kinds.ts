import { TRANSITION } from './features/index.js';
import type { ExposedProperty } from './exposes.js';
import type { Z2mDevice } from './ports.js';

// What kind of device this is, and what that means for the commands it can take (0009). Pure: shared by the bridge,
// the routes and tests, with no MQTT or storage.

const POLISH: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** The plain ASCII form of a display name, used as Zigbee2MQTT's friendly name because it becomes part of MQTT topics. */
export function z2mFriendlyName(display: string): string {
  const ascii = display
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => POLISH[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (ascii || 'device').slice(0, 60);
}

/** Whether Zigbee2MQTT offers a fade (its `transition` option) for this device; most lights do, Tuya datapoint ones don't. */
export function supportsFade(device: Z2mDevice): boolean {
  return (device.definition?.options ?? []).some((o) => o !== null && typeof o === 'object' && ((o as { name?: unknown }).name === TRANSITION || (o as { property?: unknown }).property === TRANSITION));
}

/** Tuya devices that speak Tuya's own datapoints instead of standard Zigbee clusters. */
export function isTuyaDatapoint(device: Z2mDevice): boolean {
  return device.model_id === 'TS0601';
}

export function withoutFade(values: Record<string, unknown>): Record<string, unknown> {
  const { [TRANSITION]: _fade, ...rest } = values;
  return rest;
}

/** Drops the fade for devices that can't fade, instead of having Zigbee2MQTT refuse the whole command. */
export function withoutUnsupportedFade(device: Z2mDevice, values: Record<string, unknown>): Record<string, unknown> {
  return TRANSITION in values && !supportsFade(device) ? withoutFade(values) : values;
}

/**
 * The values to send again after a missed confirmation, or null when that isn't safe: a toggle is replaced by the
 * value it was meant to reach, and a relative step (brightness up by 20 %) would apply twice, so it isn't retried.
 */
export function repeatable(values: Record<string, unknown>, expected: Record<string, unknown>, relative: Map<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (relative.has(key)) return null;
    if (key === TRANSITION) {
      out[key] = value;
      continue;
    }
    if (!(key in expected) || expected[key] === undefined) return null;
    out[key] = expected[key];
  }
  return out;
}

/** A #rrggbb colour as hue (0–359) and saturation (0–100). */
export function hexToHs(hex: string): { hue: number; saturation: number } | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return { hue: Math.round((hue + 360) % 360), saturation: max === 0 ? 0 : Math.round((d / max) * 100) };
}

const LIGHT_LOOK = ['brightness', 'color', 'color_temp', 'white_brightness'];

/**
 * Fits light values to how a device takes them (0009): a light that takes colour only as hue and saturation
 * (`color_hs`, such as Skydance WZ5) gets a hex colour as hue and saturation, since its converter ignores hex.
 * A Tuya datapoint light's converter reads 0 as "keep the previous value", so hue 0 (pure red) is sent as 359 and
 * saturation 0 as 1.
 */
export function fitLightValues(device: Z2mDevice, props: ExposedProperty[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  const colorProp = props.find((p) => p.property === 'color');
  const c = out.color as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && typeof c.hex === 'string' && colorProp?.name === 'color_hs') {
    const hs = hexToHs(c.hex);
    if (hs) out.color = hs;
  }
  if (isTuyaDatapoint(device) && out.color && typeof out.color === 'object') {
    const col = { ...(out.color as Record<string, unknown>) };
    if (col.hue === 0) col.hue = 359;
    if (col.saturation === 0) col.saturation = 1;
    out.color = col;
  }
  return out;
}

/**
 * The messages to send, in order. Most devices take everything in one. A Tuya datapoint light (Skydance WZ5) handles
 * colour, white temperature and both brightnesses with one converter, which Zigbee2MQTT uses once per message, and it
 * ignores a change of mode (colour or white) while it is off. So it gets, each in a message of its own:
 * - "on" (or any other non-look value) first, so the look that follows is applied, not just stored;
 * - a slightly different colour or white temperature before the wanted one, since an unchanged value is ignored;
 * - colour, then its brightness (in colour mode, "brightness" is the colour's brightness); or
 * - white temperature, then the white channel's brightness (a "brightness" asked with a white temperature means it).
 * Turning off needs nothing else, and a look without "on" is sent as asked.
 */
export function lightMessages(device: Z2mDevice, props: ExposedProperty[], values: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!isTuyaDatapoint(device) || !Object.keys(values).some((k) => LIGHT_LOOK.includes(k))) return [values];
  const { color, color_temp: colorTemp, brightness, white_brightness: whiteBrightness, ...rest } = values;
  const separateWhite = props.some((p) => p.property === 'white_brightness');
  const parts: Array<Record<string, unknown>> = [];
  // These controllers ignore a colour or white temperature identical to the one they have stored, and then stay in
  // their other mode (seen on the real strips). A slightly different value first makes the wanted one a change.
  if (color !== undefined) {
    const c = color as Record<string, unknown>;
    if (typeof c.hue === 'number') parts.push({ color: { ...c, hue: c.hue >= 2 ? c.hue - 1 : c.hue + 1 } });
    parts.push({ color });
    if (brightness !== undefined) parts.push({ brightness });
    if (whiteBrightness !== undefined) parts.push({ white_brightness: whiteBrightness });
  } else if (colorTemp !== undefined) {
    const ct = props.find((p) => p.property === 'color_temp');
    if (typeof colorTemp === 'number') parts.push({ color_temp: colorTemp > (ct?.min ?? 0) ? colorTemp - 1 : colorTemp + 1 });
    parts.push({ color_temp: colorTemp });
    const white = whiteBrightness ?? (separateWhite ? brightness : undefined);
    if (white !== undefined) parts.push({ white_brightness: white });
    if (!separateWhite && brightness !== undefined) parts.push({ brightness });
  } else {
    if (brightness !== undefined) parts.push({ brightness });
    if (whiteBrightness !== undefined) parts.push({ white_brightness: whiteBrightness });
  }
  if (Object.keys(rest).length > 0) parts.unshift(rest);
  return parts;
}
