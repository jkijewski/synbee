import { useEffect, useState } from 'react';
import { api, type ApiError } from '../api';
import { useApi } from '../useApi';

// How long readings are kept (0014): raw, as 5-minute averages and as hourly averages, and a cap on raw rows.
interface Settings {
  rawDays: number;
  fiveMinuteDays: number;
  hourlyDays: number;
  maxRawRows: number;
}

const FIELDS: Array<[keyof Settings, string, number, number]> = [
  ['rawDays', 'Every reading, days', 1, 90],
  ['fiveMinuteDays', '5-minute averages, days', 7, 730],
  ['hourlyDays', 'Hourly averages, days', 30, 3650],
  ['maxRawRows', 'At most this many readings', 100000, 50000000],
];

export function HistorySettings() {
  const { data, reload } = useApi<Settings>('/api/history/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => setForm(data), [data]);
  if (!form) return null;
  const save = () =>
    void api('PUT', '/api/history/settings', form).then(
      () => (setMessage({ text: 'Saved.', error: false }), reload()),
      (e: ApiError) => setMessage({ text: e.message, error: true }),
    );
  return (
    <div className="card card-body mb-3">
      <h2>Reading history</h2>
      <p className="muted small">Older readings are kept as averages, then deleted. Shorter times use less space on the NAS.</p>
      <div className="line">
        {FIELDS.map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input className="form-control form-control-sm" type="number" min={min} max={max} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} style={{ width: '9rem' }} />
          </label>
        ))}
        <button className="btn btn-primary btn-sm align-self-end" onClick={save}>
          Save
        </button>
      </div>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
    </div>
  );
}
