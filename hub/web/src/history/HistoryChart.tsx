import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { propertyLabel, type Property } from '../api';
import { featureFor } from '../features';
import { wordFor } from '../../../src/features/index.js';
import { useApi } from '../useApi';

// A device's reading history (0014): one property at a time, for 24 hours, 7 or 30 days or a year. Yes/no values are
// drawn as steps with their words; averages show their min–max band for longer ranges.
type Range = '24h' | '7d' | '30d' | '1y';
const RANGES: Array<[Range, string]> = [
  ['24h', '24 h'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['1y', '1 year'],
];
interface Point {
  at: number;
  value: number;
  min?: number;
  max?: number;
}

export function HistoryChart({ ieee, properties, labels }: { ieee: string; properties: Property[]; labels?: Record<string, string> }) {
  const available = useApi<{ properties: string[] }>(`/api/devices/${ieee}/history`);
  // Numbers first (power before on/off), so the first graph shown is the most telling one.
  const shown = properties.filter((p) => available.data?.properties.includes(p.property)).sort((a, b) => Number(a.type === 'binary') - Number(b.type === 'binary'));
  const [property, setProperty] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('24h');
  const chosen = shown.find((p) => p.property === property) ?? shown[0];
  const series = useApi<{ points: Point[] }>(chosen ? `/api/devices/${ieee}/history?property=${encodeURIComponent(chosen.property)}&range=${range}` : null);
  if (!available.data || shown.length === 0) return null;
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h3 style={{ marginRight: 'auto' }}>History</h3>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} aria-label="Reading" value={chosen!.property} onChange={(e) => setProperty(e.target.value)}>
          {shown.map((p) => (
            <option key={p.property} value={p.property}>
              {propertyLabel(p, labels)}
            </option>
          ))}
        </select>
        <div className="btn-group btn-group-sm" role="group" aria-label="Time range">
          {RANGES.map(([r, label]) => (
            <button key={r} className={`btn ${r === range ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setRange(r)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {series.data && series.data.points.length === 0 && <p className="muted">No readings in this time yet.</p>}
      {series.data && series.data.points.length > 0 && <Chart prop={chosen!} points={series.data.points} range={range} />}
    </div>
  );
}

const SPAN: Record<Range, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '1y': 365 * 864e5 };

function Chart({ prop, points, range }: { prop: Property; points: Point[]; range: Range }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = featureFor(prop);
    const binary = prop.type === 'binary';
    const unit = f.unit ?? prop.unit ?? '';
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--bs-body-color').trim() || '#333';
    const grid = css.getPropertyValue('--bs-border-color').trim() || '#ddd';
    const accent = css.getPropertyValue('--bs-primary').trim() || '#0d6efd';
    const shown = (v: number) => (f.toDisplay ? f.toDisplay(v, prop) : v);
    const x = points.map((p) => p.at / 1000);
    const y = points.map((p) => shown(p.value));
    const hasBand = points.some((p) => p.min !== undefined && p.max !== undefined && p.min !== p.max);
    const data: uPlot.AlignedData = hasBand ? [x, y, points.map((p) => shown(p.min ?? p.value)), points.map((p) => shown(p.max ?? p.value))] : [x, y];
    // History stores 1 for Zigbee2MQTT's "on" value and 0 for "off" (0014): label them with that value's own word.
    const words = f.words
      ? { on: wordFor(prop, prop.valueOn ?? true) ?? f.words.on, off: wordFor(prop, prop.valueOff ?? false) ?? f.words.off }
      : binary
        ? { on: String(prop.valueOn ?? 'on').toLowerCase(), off: String(prop.valueOff ?? 'off').toLowerCase() }
        : undefined;
    const axisValue = (_: uPlot, ticks: number[]) => ticks.map((t) => (binary && words ? (t === 1 ? words.on : t === 0 ? words.off : '') : `${Math.round(t * 10) / 10}${unit ? ` ${unit}` : ''}`));
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: 220,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      // The whole chosen time span, even with few readings.
      scales: { x: { time: true, range: () => [(Date.now() - SPAN[range]) / 1000, Date.now() / 1000] }, ...(binary ? { y: { range: [-0.1, 1.1] } } : {}) },
      axes: [
        { stroke: text, grid: { stroke: grid, width: 1 } },
        { stroke: text, grid: { stroke: grid, width: 1 }, values: axisValue, size: 70, ...(binary ? { splits: () => [0, 1] } : {}) },
      ],
      series: [
        {},
        { stroke: accent, width: 2, ...(binary ? { paths: uPlot.paths.stepped!({ align: 1 }) } : {}), points: { show: points.length < 60 } },
        ...(hasBand ? [{ stroke: 'transparent', width: 0 }, { stroke: 'transparent', width: 0 }] : []),
      ],
      ...(hasBand ? { bands: [{ series: [3, 2] as [number, number], fill: `${accent}22` }] } : {}),
    };
    const plot = new uPlot(opts, data, el);
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 220 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [prop, points, range]);
  return <div ref={box} className="history-chart" />;
}
