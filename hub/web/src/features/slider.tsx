import { useEffect, useState } from 'react';

// A range slider that sends only when released, so dragging doesn't flood the Zigbee network.
export function Slider({
  min,
  max,
  value,
  onCommit,
  track,
  label,
  format,
}: {
  min: number;
  max: number;
  value: number | undefined;
  onCommit: (v: number) => void;
  track: string;
  label: string;
  format: (v: number) => string;
}) {
  const [v, setV] = useState(value ?? min);
  useEffect(() => setV(value ?? min), [value, min]);
  return (
    <span className="slider-wrap">
      <input
        type="range"
        className="form-range feature-slider"
        aria-label={label}
        min={min}
        max={max}
        value={v}
        style={{ background: track }}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => onCommit(v)}
        onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && onCommit(v)}
      />
      <span className="slider-value">{value === undefined && v === min ? '–' : format(v)}</span>
    </span>
  );
}
