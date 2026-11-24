import { useState } from 'react';
import { api, ApiError } from './api';
import { useApi } from './useApi';

// Who may use this action or room, or see this status tile, in the app (0020), on the item's own page.

interface Access {
  id: number;
  name: string;
  allowed: boolean;
}

export function MemberAccess({ kind, id }: { kind: 'action' | 'room' | 'tile'; id: number | string }) {
  // Status tiles ("sensors:3", "check:2", "device:0x…") have their own route; actions and rooms share one.
  const url = kind === 'tile' ? `/api/tile-access/${id}` : `/api/member-access/${kind}/${id}`;
  const access = useApi<Access[]>(url);
  const [error, setError] = useState('');
  if (!access.data || access.data.length === 0) return null;
  const set = async (memberId: number, allowed: boolean) => {
    setError('');
    const ids = access.data!.filter((m) => (m.id === memberId ? allowed : m.allowed)).map((m) => m.id);
    try {
      access.setData(await api<Access[]>('PUT', url, { allowed: ids }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  return (
    <div className="mt-2">
      <h4 className="h6 mb-1">In the app, for</h4>
      <div className="line" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        {access.data.map((m) => (
          <label className="line" key={m.id}>
            <input className="form-check-input" type="checkbox" checked={m.allowed} onChange={(e) => void set(m.id, e.target.checked)} />
            {m.name}
          </label>
        ))}
      </div>
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}
