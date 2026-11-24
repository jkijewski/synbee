import { useState } from 'react';
import { api, ApiError, type DeviceDetail } from '../api';



// Names for the channels of a multi-channel switch, such as spot, LED and regał.
export function ChannelLabels({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const endpoints = [...new Set(device.properties.map((p) => p.endpoint).filter((e): e is string => Boolean(e)))];
  const [labels, setLabels] = useState<Record<string, string>>(device.labels);
  const [message, setMessage] = useState('');
  if (endpoints.length < 2) return null;
  return (
    <div className="card card-body mb-3">
      <h3>Channel names</h3>
      <div className="line">
        {endpoints.map((ep) => (
          <label key={ep}>
            {ep}
            <input className="form-control form-control-sm" value={labels[ep] ?? ''} maxLength={40} placeholder="name" onChange={(e) => setLabels({ ...labels, [ep]: e.target.value })} />
          </label>
        ))}
        <button className="btn btn-outline-secondary btn-sm"
          onClick={() =>
            void api('PUT', `/api/devices/${device.ieee}/labels`, Object.fromEntries(endpoints.map((ep) => [ep, labels[ep] ?? '']))).then(
              () => (setMessage('Saved.'), onSaved()),
              (e: ApiError) => setMessage(e.message),
            )
          }
        >
          Save names
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
