import { featureFor } from '../../../src/features/index.js';
import type { Property } from '../api';
import { brightnessUI } from './brightness';
import { colorUI } from './color';
import { colorTempUI } from './colorTemp';
import { genericUI } from './generic';
import { readingUI } from './readings';
import { stateUI } from './state';
import { wordsUI } from './words';
import type { FeatureUI } from './types';

export type { FeatureUI } from './types';

/**
 * Web controls by feature id (the hub module of the same id decides which properties it covers). Features without an
 * entry here use the generic control for their type. To add a feature's own control, add a file and a line here.
 */
const UI: Record<string, FeatureUI> = {
  state: stateUI,
  brightness: brightnessUI,
  white_brightness: brightnessUI,
  color_temp: colorTempUI,
  color: colorUI,
  temperature: readingUI,
  humidity: readingUI,
  battery: readingUI,
  power: readingUI,
  illuminance: readingUI,
  energy: readingUI,
  voltage: readingUI,
  current: readingUI,
  pressure: readingUI,
  co2: readingUI,
};

export function featureUI(prop: Property): FeatureUI {
  const f = featureFor(prop);
  return UI[f.id] ?? (f.words ? wordsUI : f.readOnly ? readingUI : genericUI);
}

export { featureFor };
