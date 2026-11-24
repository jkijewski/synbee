import { DEFAULT_FADE_SECONDS, featureFor } from '../../../src/features/index.js';
import { kelvinToHex } from './colorMath';
import { Slider } from './slider';
import type { FeatureUI } from './types';

// White temperature in Kelvin, on a track painted from warm to cold in the light's own colours.
type Prop = Parameters<FeatureUI['Display']>[0]['prop'];
const toK = (prop: Prop, mired: number) => featureFor(prop).toDisplay!(mired, prop);
const toMired = (prop: Prop, k: number) => featureFor(prop).fromDisplay!(k, prop);
const range = (prop: Prop) => {
  const warm = toK(prop, prop.max ?? 500);
  const cold = toK(prop, prop.min ?? 153);
  return { warm, cold };
};
const track = (prop: Prop) => {
  const { warm, cold } = range(prop);
  const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => kelvinToHex(warm + (cold - warm) * f));
  return `linear-gradient(90deg, ${stops.join(', ')})`;
};

export const colorTempUI: FeatureUI = {
  Control: ({ prop, value, onSend }) => {
    const { warm, cold } = range(prop);
    return (
      <Slider
        label="White temperature"
        min={warm}
        max={cold}
        value={typeof value === 'number' ? toK(prop, value) : undefined}
        track={track(prop)}
        format={(v) => `${v} K`}
        onCommit={(v) => void onSend({ [prop.property]: toMired(prop, v), transition: DEFAULT_FADE_SECONDS })}
      />
    );
  },
  Editor: ({ prop, value, onChange }) => {
    const { warm, cold } = range(prop);
    return (
      <Slider
        label="White temperature"
        min={warm}
        max={cold}
        value={typeof value === 'number' ? toK(prop, value) : undefined}
        track={track(prop)}
        format={(v) => `${v} K`}
        onCommit={(v) => onChange(toMired(prop, v))}
      />
    );
  },
  Display: ({ prop, value }) =>
    typeof value === 'number' ? (
      <span className="line">
        <span className="color-dot" style={{ background: kelvinToHex(toK(prop, value)) }} /> {toK(prop, value)} K
      </span>
    ) : (
      <span className="muted">unknown</span>
    ),
};
