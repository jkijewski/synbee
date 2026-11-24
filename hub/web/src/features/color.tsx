import { DEFAULT_FADE_SECONDS } from '../../../src/features/index.js';
import { colorToHex } from './colorMath';
import type { FeatureUI } from './types';

// Colour: a colour picker and a few favourites; Zigbee2MQTT takes { hex } and reports xy or hue/saturation.
const FAVOURITES = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55'];

function Picker({ value, onPick }: { value: unknown; onPick: (hex: string) => void }) {
  const hex = colorToHex(value) ?? '#ffffff';
  return (
    <span className="line">
      <input type="color" className="form-control form-control-color" aria-label="Colour" value={hex} onChange={(e) => onPick(e.target.value)} />
      {FAVOURITES.map((c) => (
        <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

export const colorUI: FeatureUI = {
  Control: ({ prop, value, onSend }) => <Picker value={value} onPick={(hex) => void onSend({ [prop.property]: { hex }, transition: DEFAULT_FADE_SECONDS })} />,
  Editor: ({ value, onChange }) => <Picker value={value} onPick={(hex) => onChange({ hex })} />,
  Display: ({ value }) => {
    const hex = colorToHex(value);
    return hex ? (
      <span className="line">
        <span className="color-dot" style={{ background: hex }} /> {hex}
      </span>
    ) : (
      <span className="muted">unknown</span>
    );
  },
};
