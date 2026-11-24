import { useId, useState } from 'react';
import { confirmationFor, DEFAULT_FADE_SECONDS, onlyLightValues, TRANSITION, TYPICAL_LIGHT } from '../../src/features/index.js';
import { propertyLabel, type Property } from './api';
import { featureFor, featureUI } from './features';

// Picks one or more "property = value" pairs from a device's or group's capabilities, using each feature's own
// editor (0008). Features with relative steps also offer "change by", and lights a fade time.

interface Choice {
  key: string;
  label: string;
  prop: Property;
  relative: boolean;
}

function choicesFor(properties: Property[], labels?: Record<string, string>): Choice[] {
  const out: Choice[] = [];
  for (const p of properties.filter((x) => x.writable)) {
    const f = featureFor(p);
    out.push({ key: p.property, label: propertyLabel(p, labels), prop: p, relative: false });
    if (f.relative) out.push({ key: p.endpoint ? `${f.relative.key}_${p.endpoint}` : f.relative.key, label: `${propertyLabel(p, labels)}: change by`, prop: p, relative: true });
  }
  return out;
}

const defaultFor = (c: Choice): unknown => {
  if (c.relative) return featureFor(c.prop).relative!.toRaw(20, c.prop);
  const f = featureFor(c.prop);
  if (f.id === 'brightness') return f.fromDisplay!(50, c.prop);
  if (f.id === 'color_temp') return f.fromDisplay!(2700, c.prop);
  if (f.id === 'color') return { hex: '#ff9500' };
  return defaultValue(c.prop);
};

export function ValuesEditor({
  properties,
  labels,
  values,
  onChange,
  canFade = true,
}: {
  properties: Property[];
  labels?: Record<string, string>;
  /** False for devices and groups that can't fade (no transition option), so no fade time is offered. */
  canFade?: boolean;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  // Imported light steps whose lights haven't joined yet are edited as a usual colour bulb.
  const assumed = properties.length === 0 && onlyLightValues(values);
  if (assumed) properties = TYPICAL_LIGHT;
  // Settings and diagnostics (0008) are offered only on request, or when a step already uses one.
  const usesAdvanced = properties.some((p) => p.category && p.property in values);
  const [showAll, setShowAll] = useState(false);
  const hidden = properties.filter((p) => p.writable && p.category).length;
  const allChoices = choicesFor(properties, labels);
  const choices = showAll || usesAdvanced ? allChoices : allChoices.filter((c) => !c.prop.category || c.key in values);
  const question = confirmationFor(properties, values);
  const fadeId = useId();
  const fades = canFade && properties.some((p) => p.writable && featureFor(p).fades);
  const entries = Object.entries(values).filter(([k]) => k !== TRANSITION);
  const fade = values[TRANSITION];
  const rebuild = (list: Array<[string, unknown]>, t: unknown = fade) => {
    const anyFading = list.some(([k]) => {
      const c = choices.find((x) => x.key === k);
      return c && (c.relative || featureFor(c.prop).fades);
    });
    onChange(Object.fromEntries([...list, ...(anyFading && t !== undefined ? [[TRANSITION, t] as [string, unknown]] : [])]));
  };
  const setAt = (i: number, key: string, value: unknown) => rebuild(entries.map(([k, v], j) => (j === i ? [key, value] : [k, v])));
  const unused = choices.filter((c) => !(c.key in values));
  const add = () => {
    const c = unused[0]!;
    const next: Array<[string, unknown]> = [...entries, [c.key, defaultFor(c)]];
    rebuild(next, fade ?? (fades && (c.relative || featureFor(c.prop).fades) ? DEFAULT_FADE_SECONDS : undefined));
  };
  const showFade = fades && entries.some(([k]) => {
    const c = choices.find((x) => x.key === k);
    return c && (c.relative || featureFor(c.prop).fades);
  });
  // One Bootstrap grid row per setting: the setting (3 of 12 columns), its value (the rest), and the remove button
  // in its own narrow column, so every row lines up.
  return (
    <div className="values-editor">
      {entries.map(([key, value], i) => {
        const c = choices.find((x) => x.key === key);
        return (
          <div className="row g-2 align-items-center mb-1" key={i}>
            <div className="col-12 col-md-4 col-lg-3">
              <select
                className="form-select form-select-sm"
                aria-label="Setting"
                value={key}
                onChange={(e) => {
                  const next = choices.find((x) => x.key === e.target.value)!;
                  setAt(i, next.key, defaultFor(next));
                }}
              >
                {!c && <option value={key}>{key} (not offered by the device)</option>}
                {choices.map((x) => (
                  <option key={x.key} value={x.key} disabled={x.key !== key && x.key in values}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col d-flex flex-wrap align-items-center gap-2 setting-value">
              {c && <StepValue choice={c} value={value} onChange={(v) => setAt(i, key, v)} />}
            </div>
            <div className="col-auto">
              {entries.length > 1 && (
                <button className="btn btn-outline-secondary btn-sm" aria-label="Remove setting" title="Remove this setting" onClick={() => rebuild(entries.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
      {showFade && (
        <div className="row g-2 align-items-center mb-1">
          <div className="col-12 col-md-4 col-lg-3">
            <label className="col-form-label col-form-label-sm py-0" htmlFor={`fade-${fadeId}`}>
              Fade
            </label>
          </div>
          <div className="col d-flex align-items-center gap-2">
            <input
              id={`fade-${fadeId}`}
              className="form-control form-control-sm"
              type="number"
              min={0}
              max={3600}
              step={0.5}
              value={typeof fade === 'number' ? fade : 0}
              onChange={(e) => rebuild(entries, Number(e.target.value) > 0 ? Number(e.target.value) : undefined)}
              style={{ width: '6rem' }}
            />
            <span className="small text-body-secondary">seconds</span>
          </div>
          <div className="col-auto" />
        </div>
      )}
      {assumed && <p className="text-body-secondary small mb-1">Its lights haven't joined yet, so these are the usual light settings; check them when they have.</p>}
      {question && <p className="text-warning-emphasis small mb-1">⚠ This step unlocks a door when it runs. It won't ask then, so check who can start it.</p>}
      {choices.length === 0 && entries.length === 0 && <p className="text-body-secondary small mb-1">This has no settings yet; it may not have joined.</p>}
      <div className="d-flex flex-wrap gap-2">
        {unused.length > 0 && (
          <button className="btn btn-outline-secondary btn-sm" onClick={add}>
            {entries.length ? 'Add another setting' : 'Choose a setting'}
          </button>
        )}
        {hidden > 0 && !showAll && !usesAdvanced && (
          <button className="btn btn-link btn-sm" onClick={() => setShowAll(true)}>
            Show settings ({hidden})
          </button>
        )}
      </div>
    </div>
  );
}

/** The value of one step setting: the feature's own editor, or a ± % amount for "change by". */
function StepValue({ choice, value, onChange }: { choice: Choice; value: unknown; onChange: (v: unknown) => void }) {
  const f = featureFor(choice.prop);
  if (choice.relative) {
    // Shown in display units (e.g. % for brightness, raw mireds for white temperature).
    const rel = f.relative!;
    const perUnit = rel.toRaw(100, choice.prop) / 100 || 1;
    const shown = typeof value === 'number' ? Math.round(value / perUnit) : 20;
    return (
      <span className="line">
        <select className="form-select form-select-sm" aria-label="Direction" value={shown >= 0 ? 'up' : 'down'} onChange={(e) => onChange(rel.toRaw(Math.abs(shown) * (e.target.value === 'up' ? 1 : -1), choice.prop))}>
          <option value="up">{f.id === 'color_temp' ? 'warmer by' : 'up by'}</option>
          <option value="down">{f.id === 'color_temp' ? 'colder by' : 'down by'}</option>
        </select>
        <input
          className="form-control form-control-sm"
          type="number"
          min={1}
          max={100}
          aria-label="Amount"
          value={Math.abs(shown)}
          onChange={(e) => onChange(rel.toRaw(Math.max(1, Number(e.target.value)) * (shown >= 0 ? 1 : -1), choice.prop))}
          style={{ width: '5rem' }}
        />
        {f.unit === '%' ? '%' : ''}
      </span>
    );
  }
  const UI = featureUI(choice.prop).Editor;
  return <UI prop={choice.prop} value={value} onChange={onChange} />;
}

export function defaultValue(p: Property): unknown {
  if (p.type === 'binary') return p.valueToggle ?? p.valueOn;
  if (p.type === 'enum') return p.values?.[0];
  if (p.type === 'numeric') return p.min ?? 0;
  if (p.property === 'color') return { hex: '#ffffff' };
  return undefined;
}

/** A single value, for conditions and triggers: the feature's own editor without the toggle choice. */
export function ValueInput({ prop, value, onChange }: { prop: Property | undefined; value: unknown; onChange: (v: unknown) => void }) {
  if (!prop) return <input className="form-control form-control-sm" aria-label="Value" value={value === undefined ? '' : JSON.stringify(value)} readOnly />;
  const UI = featureUI(prop).Editor;
  return <UI prop={prop} value={value} onChange={onChange} />;
}
