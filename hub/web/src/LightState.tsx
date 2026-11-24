import { summaryWords, type LightSummary } from '../../src/features/light-summary.js';

// A light's look (0008): a swatch of its colour or white, and "On · red · 29 %" / "Off".
export function LightState({ light, large }: { light: LightSummary | null | undefined; large?: boolean }) {
  const words = light ? summaryWords(light) : '';
  if (!light || !words) return null;
  const on = light.on === true;
  return (
    <span className={`light-state ${on ? 'is-on' : 'is-off'}${large ? ' large' : ''}`} title={words}>
      <span className="light-swatch" style={on && light.swatch ? { background: light.swatch } : undefined} aria-hidden />
      {words}
    </span>
  );
}

/** A light group's look as words from the hub, e.g. "On · red · 29 %", "Off" or "2 of 3 on". */
export function GroupLightState({ words }: { words: string | null | undefined }) {
  if (!words) return null;
  const on = words !== 'Off';
  return (
    <span className={`light-state ${on ? 'is-on' : 'is-off'}`} title={words}>
      <span className="light-swatch" aria-hidden />
      {words}
    </span>
  );
}
