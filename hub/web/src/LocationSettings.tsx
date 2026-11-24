import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useApi } from './useApi';

interface LocationState {
  location: { latitude: number; longitude: number } | null;
  sunrise: string | null;
  sunset: string | null;
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

// The home's location, for automations at sunrise or sunset and "when it is dark" (0010). Sun times are computed
// on the hub; nothing is sent anywhere.
export function LocationSettings() {
  const { data, reload } = useApi<LocationState>('/api/location');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    setLat(data?.location ? String(data.location.latitude) : '');
    setLon(data?.location ? String(data.location.longitude) : '');
  }, [data]);
  const save = (body: unknown) =>
    void api('PUT', '/api/location', body).then(
      () => (setMessage({ text: 'Saved.', error: false }), reload()),
      (e: ApiError) => setMessage({ text: e.message, error: true }),
    );
  return (
    <div className="card card-body mb-3">
      <h2>Home location</h2>
      <p className="muted small">
        For automations at sunrise or sunset and "when it is dark". Approximate is enough, such as your town's coordinates in decimal degrees (e.g. 52.23, 21.01).
        Sunrise and sunset are computed on the hub; the location never leaves it.
      </p>
      <div className="line">
        <label>
          Latitude
          <input className="form-control form-control-sm" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="52.23" style={{ width: '8rem' }} />
        </label>
        <label>
          Longitude
          <input className="form-control form-control-sm" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="21.01" style={{ width: '8rem' }} />
        </label>
        <button className="btn btn-primary btn-sm align-self-end" onClick={() => save({ latitude: Number(lat.replace(',', '.')), longitude: Number(lon.replace(',', '.')) })}>
          Save
        </button>
        {data?.location && (
          <button className="btn btn-outline-secondary btn-sm align-self-end" onClick={() => save({ location: null })}>
            Clear
          </button>
        )}
      </div>
      {data?.location ? (
        <p className="small mb-0">
          Today: sunrise {time(data.sunrise)}, sunset {time(data.sunset)}.
        </p>
      ) : (
        <p className="small text-warning-emphasis mb-0">Not set: sunrise and sunset events don't run, and "it is dark" is never true.</p>
      )}
      {message && <p className={message.error ? 'text-danger mb-0' : 'text-success mb-0'}>{message.text}</p>}
    </div>
  );
}
