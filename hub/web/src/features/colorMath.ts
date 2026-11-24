// Colour conversions for showing a light's colour, which Zigbee2MQTT reports as xy or hue/saturation.

export function hsToHex(h: number, s: number, v = 1): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * (s / 100) * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function xyToHex(x: number, y: number): string {
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  [r, g, b] = [gamma(r), gamma(g), gamma(b)];
  const m = Math.max(r, g, b, 1e-6);
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, c / m) * 255).toString(16).padStart(2, '0')).join('');
}

/** A hex colour for whatever form Zigbee2MQTT or an imported step uses, or null. */
export function colorToHex(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (typeof c.hex === 'string') return c.hex;
  if (typeof c.x === 'number' && typeof c.y === 'number' && c.y > 0) return xyToHex(c.x, c.y);
  if (typeof c.hue === 'number' && typeof c.saturation === 'number') return hsToHex(c.hue, c.saturation);
  return null;
}

/** Approximate colour of white light at a temperature in Kelvin, for the slider track. */
export function kelvinToHex(k: number): string {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}
