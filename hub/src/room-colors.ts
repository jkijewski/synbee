// Room colours (0012): the owner's choice, or a calm palette colour farthest in hue from those already used. Pure:
// shared by the hub (for the app) and the web UI, so a room has the same colour everywhere.

/** A curated set of calm colours, spread around the colour wheel. */
export const PALETTE = ['#7aa7e0', '#e0a35c', '#79bf8a', '#c98ad1', '#e07f7f', '#5fb8b8', '#c9b553', '#8f8fdc', '#d98fb0', '#8fb35a', '#d0876a', '#6fa0c0'];

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Each room's colour: the owner's choice, or the palette colour farthest in hue from those already used. */
export function roomColors(rooms: Array<{ id: number; color: string | null }>): Map<number, string> {
  const out = new Map<number, string>();
  const used: number[] = [];
  for (const r of rooms) if (r.color) (out.set(r.id, r.color), used.push(hue(r.color)));
  for (const r of rooms) {
    if (out.has(r.id)) continue;
    const pick = [...PALETTE]
      .filter((c) => ![...out.values()].includes(c))
      .sort((a, b) => Math.min(...used.map((u) => distance(hue(b), u)), 360) - Math.min(...used.map((u) => distance(hue(a), u)), 360))[0] ?? PALETTE[r.id % PALETTE.length]!;
    out.set(r.id, pick);
    used.push(hue(pick));
  }
  return out;
}
