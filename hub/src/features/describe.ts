import type { ExposedProperty } from '../exposes.js';
import { featureFor, wordFor } from './index.js';
import { isLight, lightSummary, summaryWords, type LightMode } from './light-summary.js';

// A device's state in words (0008), for the app's details and room pages: a one-line summary and the readings
// behind it. Pure: shared by the hub and the web UI.

export interface Reading {
  property: string;
  label: string;
  text: string;
  attention: 'alarm' | 'warning' | null;
}

const GENERIC_IDS = new Set(['binary', 'numeric', 'enum', 'other']);
const LIGHT_PARTS = new Set(['state', 'brightness', 'white_brightness', 'color', 'color_temp', 'color_mode', 'color_temp_startup']);

/** One value in words: Open / Closed, 21.4 °C, 48 %, or the enum's own word. Null for values with no short form. */
export function describeValue(prop: ExposedProperty, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const feature = featureFor(prop);
  if (prop.type === 'binary') {
    if (feature.words) return wordFor(prop, value);
    return value === (prop.valueOn ?? true) || value === 'ON' ? 'On' : 'Off';
  }
  if (typeof value === 'number') {
    const shown = feature.toDisplay ? feature.toDisplay(value, prop) : value;
    const unit = feature.unit ?? prop.unit ?? '';
    const rounded = Math.round(shown * 10) / 10;
    return unit ? `${rounded} ${unit}` : String(rounded);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return null;
}

/** The readings worth showing: main controls and readings plus the battery, not settings or diagnostics. */
export function describeDevice(
  props: ExposedProperty[],
  state: Record<string, unknown>,
  mode: LightMode | null,
  /** The owner's names for a multi-channel device's channels, by endpoint (e.g. l1 → "Desk lamp"). */
  channels: Record<string, string> = {},
): { summary: string; readings: Reading[] } {
  const light = isLight(props);
  const readings: Reading[] = [];
  for (const p of props) {
    if ((p.category && p.property !== 'battery') || (light && LIGHT_PARTS.has(p.property))) continue;
    const text = describeValue(p, state[p.property]);
    if (text === null) continue;
    const feature = featureFor(p);
    const label = (p.endpoint && channels[p.endpoint]) || (GENERIC_IDS.has(feature.id) || p.endpoint ? p.name : feature.label);
    readings.push({ property: p.property, label, text, attention: feature.attention?.(state[p.property], p) ?? null });
  }
  // A multi-channel device says which channel is which ("Desk lamp On · Desk spot Off"); others just the values.
  const main = readings.filter((r) => r.property !== 'battery');
  const channelled = props.some((p) => p.endpoint);
  const summary = light ? summaryWords(lightSummary(props, state, mode)) : main.slice(0, channelled ? 3 : 2).map((r) => (channelled ? `${r.label} ${r.text}` : r.text)).join(' · ');
  return { summary, readings };
}
