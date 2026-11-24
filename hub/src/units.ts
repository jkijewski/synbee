import type { Db } from './db.js';
import { Settings } from './settings.js';

// Units the owner chooses for showing readings (plan: checks and alerts): Celsius or Fahrenheit. Devices report
// Celsius; SynBee converts what it shows in the app, status tiles and notification texts.

export const UNITS_KEY = 'units';
export type TemperatureUnit = 'C' | 'F';

export function temperatureUnit(db: Db): TemperatureUnit {
  return new Settings(db).get<{ temperature?: TemperatureUnit }>(UNITS_KEY, {}).temperature === 'F' ? 'F' : 'C';
}

export function setTemperatureUnit(db: Db, unit: unknown): TemperatureUnit {
  if (unit !== 'C' && unit !== 'F') throw new Error('Choose C or F');
  new Settings(db).set(UNITS_KEY, { temperature: unit });
  return unit;
}

export const toFahrenheit = (c: number) => Math.round((c * 9) / 5 * 10 + 320) / 10;

/** Rewrites every "21.4 °C" in a text to the chosen unit. */
export function inUnit(text: string, unit: TemperatureUnit): string {
  if (unit === 'C') return text;
  return text.replace(/(-?\d+(?:\.\d+)?) ?°C/g, (_m, n: string) => `${toFahrenheit(Number(n))} °F`);
}

/**
 * A colour for a temperature in Celsius, from blue (cold) through green (comfortable) to red (hot): a hint on the
 * app's tile, as #rrggbb.
 */
export function temperatureColor(c: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [10, [59, 130, 246]],
    [18, [56, 189, 248]],
    [21, [74, 186, 106]],
    [24, [240, 162, 59]],
    [28, [229, 83, 75]],
  ];
  if (c <= stops[0]![0]) return hex(stops[0]![1]);
  for (let i = 1; i < stops.length; i++) {
    const [t1, a] = stops[i - 1]!;
    const [t2, b] = stops[i]!;
    if (c <= t2) {
      const f = (c - t1) / (t2 - t1);
      return hex([0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * f)) as [number, number, number]);
    }
  }
  return hex(stops[stops.length - 1]![1]);
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
