import { describe, expect, it } from 'vitest';
import { flattenExposes } from '../src/exposes.js';
import { colourName, isLight, lightSummary, summaryWords } from '../src/features/light-summary.js';
import { sampleBulb, sampleWz5 } from '../src/sim/sample-devices.js';

// A light's look in a few words (0008).
const wz5 = flattenExposes(sampleWz5('0x1', 'a').definition!.exposes);
const bulb = flattenExposes(sampleBulb('0x2', 'b').definition!.exposes);

describe('light summary', () => {
  it('knows lights', () => {
    expect(isLight(wz5)).toBe(true);
    expect(isLight(flattenExposes([{ type: 'numeric', property: 'temperature', name: 'temperature', access: 1 }]))).toBe(false);
  });

  it('names colours', () => {
    expect([0, 3, 30, 60, 120, 180, 240, 280, 320, 359].map(colourName)).toEqual(['red', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'red']);
  });

  it('says off, a colour with its brightness, or a white with the white channel brightness', () => {
    const state = { state: 'ON', color: { hue: 3, saturation: 100 }, brightness: 74, color_temp: 357, white_brightness: 254, color_mode: 'hs' };
    expect(summaryWords(lightSummary(wz5, { ...state, state: 'OFF' }, 'white'))).toBe('Off');
    expect(summaryWords(lightSummary(wz5, state, 'color'))).toBe('On · red · 29 %');
    const white = lightSummary(wz5, state, 'white');
    expect(summaryWords(white)).toBe('On · warm white 2800 K · 100 %');
    expect(white.swatch).toBe('#ffc27a');
  });

  it("uses a bulb's own colour mode when the hub hasn't set one", () => {
    expect(summaryWords(lightSummary(bulb, { state: 'ON', color_temp: 200, brightness: 254, color_mode: 'color_temp' }, null))).toBe('On · cold white 5000 K · 100 %');
    expect(summaryWords(lightSummary(bulb, { state: 'ON', color: { hex: '#0000ff' }, brightness: 127, color_mode: 'xy' }, null))).toBe('On · blue · 50 %');
    expect(summaryWords(lightSummary(bulb, {}, null))).toBe('');
  });
});
