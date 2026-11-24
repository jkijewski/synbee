import type { FeatureModule } from './types.js';

/** Tuya colour_data: "hhhhssssvvvv" hex, or {"h","s","v"} JSON; s and v from 0 to 1000. */
export function tuyaColour(raw: unknown): { hue: number; saturation: number; brightness: number } | null {
  let h: number, s: number, v: number;
  if (typeof raw === 'string' && /^[0-9a-f]{12}$/i.test(raw)) {
    [h, s, v] = [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12)].map((x) => parseInt(x, 16)) as [number, number, number];
  } else {
    let o: unknown = raw;
    if (typeof raw === 'string') {
      try {
        o = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!o || typeof o !== 'object') return null;
    const x = o as Record<string, unknown>;
    [h, s, v] = [Number(x.h), Number(x.s), Number(x.v)];
  }
  if (![h, s, v].every(Number.isFinite)) return null;
  return { hue: Math.round(h) % 360, saturation: Math.round(Math.min(1000, s) / 10), brightness: Math.max(1, Math.round((Math.min(1000, v) / 1000) * 254)) };
}

// Colour of a light. Zigbee2MQTT accepts {hex}, {hue, saturation} or {x, y}, and reports hs or xy.
export const color: FeatureModule = {
  id: 'color',
  label: 'Colour',
  matches: (p) => p.property === 'color' || /^color_(xy|hs)$/.test(p.name),
  fades: true,
  operators: ['eq', 'ne'],
  tuya: [
    {
      code: 'colour_data',
      translate(_c, v, notes) {
        const c = tuyaColour(v);
        if (!c) return null;
        notes.push("Colours converted from Tuya's format; check them by eye.");
        return { color: { hue: c.hue, saturation: c.saturation }, brightness: c.brightness };
      },
    },
  ],
};
