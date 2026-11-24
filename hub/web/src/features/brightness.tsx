import { DEFAULT_FADE_SECONDS, featureFor } from '../../../src/features/index.js';
import { Slider } from './slider';
import type { FeatureUI } from './types';

// Brightness in %, on a dark-to-bright track, with quick presets.
const pct = (prop: Parameters<FeatureUI['Display']>[0]['prop'], raw: number) => featureFor(prop).toDisplay!(raw, prop);
const raw = (prop: Parameters<FeatureUI['Display']>[0]['prop'], p: number) => featureFor(prop).fromDisplay!(p, prop);
const TRACK = 'linear-gradient(90deg, #2b2b2b, #fff4c2)';

export const brightnessUI: FeatureUI = {
  Control: ({ prop, value, onSend }) => (
    <span className="line">
      <Slider
        label="Brightness"
        min={0}
        max={100}
        value={typeof value === 'number' ? pct(prop, value) : undefined}
        track={TRACK}
        format={(v) => `${v} %`}
        onCommit={(v) => void onSend({ [prop.property]: raw(prop, v), transition: DEFAULT_FADE_SECONDS })}
      />
      <span className="btn-group btn-group-sm">
        {[25, 50, 100].map((p) => (
          <button key={p} className="btn btn-outline-secondary" onClick={() => void onSend({ [prop.property]: raw(prop, p), transition: DEFAULT_FADE_SECONDS })}>
            {p} %
          </button>
        ))}
      </span>
    </span>
  ),
  Editor: ({ prop, value, onChange }) => (
    <Slider
      label="Brightness"
      min={1}
      max={100}
      value={typeof value === 'number' ? pct(prop, value) : undefined}
      track={TRACK}
      format={(v) => `${v} %`}
      onCommit={(v) => onChange(raw(prop, v))}
    />
  ),
  Display: ({ prop, value }) => (typeof value === 'number' ? <span>{pct(prop, value)} %</span> : <span className="muted">unknown</span>),
};
