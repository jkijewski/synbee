import { useState } from 'react';
import { api, propertyLabel, type ApiError, type Choices, type SensorGroup, type TileLevel } from './api';
import { MemberAccess } from './MemberAccess';
import { useRooms } from './RoomSections';
import { useApi } from './useApi';

// Sensor groups (plan: checks and alerts): named sets of yes/no sensors of one kind, read as one state in words.
// Used by the app's status tiles, automations (WHEN and IF) and checks.

export const LEVEL_BADGE: Record<TileLevel, string> = { fine: 'text-bg-success', info: 'text-bg-secondary', warning: 'text-bg-warning', alarm: 'text-bg-danger' };

type Draft = Omit<SensorGroup, 'id' | 'kind' | 'status'> & { id?: number };
const blank = (): Draft => ({ name: '', roomId: null, tile: true, labels: { active: '', inactive: '' }, members: [] });

export function SensorGroupsPage() {
  const list = useApi<SensorGroup[]>('/api/sensor-groups', { refreshMs: 10000 });
  const [editing, setEditing] = useState<Draft | null>(null);
  const { rooms } = useRooms();
  if (editing) return <SensorGroupEditor initial={editing} rooms={rooms} onDone={() => (setEditing(null), list.reload())} />;
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Sensor groups</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(blank())}>
          New sensor group
        </button>
      </div>
      <p className="small text-body-secondary">
        Several yes/no sensors of one kind read as one state, such as "Windows: all closed" or "2 of 5 open: Kitchen, Bedroom". Use them in automations
        ("WHEN Windows: some open for 10 min"), in checks, and as a tile in the app.
      </p>
      {list.data?.length === 0 && <p className="muted">No sensor groups yet.</p>}
      <div className="list">
        {list.data?.map((g) => (
          <div className="card" key={g.id}>
            <div className="line">
              <strong style={{ marginRight: 'auto' }}>{g.name}</strong>
              {g.status && <span className={`badge rounded-pill ${LEVEL_BADGE[g.status.level]}`}>{g.status.text}</span>}
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing({ id: g.id, name: g.name, roomId: g.roomId, tile: g.tile, labels: g.labels, members: g.members })}>
                Edit
              </button>
            </div>
            <div className="small muted">
              {g.members.map((m) => m.name ?? m.ieee).join(', ')}
              {g.tile ? ` · tile in ${rooms.find((r) => r.id === g.roomId)?.name ?? 'Other'}` : ' · no tile'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SensorGroupEditor({ initial, rooms, onDone }: { initial: Draft; rooms: Array<{ id: number; name: string }>; onDone: () => void }) {
  const [g, setG] = useState(initial);
  const [error, setError] = useState('');
  const choices = useApi<Choices>('/api/rule-choices');
  // Every yes/no reading of every device: contacts, leaks, motion, locks…
  const sensors = (choices.data?.devices ?? []).flatMap((d) =>
    d.properties.filter((p) => p.type === 'binary' && !p.category && p.readable).map((p) => ({ ieee: d.ieee, property: p.property, label: `${d.name}: ${propertyLabel(p, d.labels)}` })),
  );
  const has = (ieee: string, property: string) => g.members.some((m) => m.ieee === ieee && m.property === property);
  const toggle = (ieee: string, property: string, on: boolean) =>
    setG({ ...g, members: on ? [...g.members, { ieee, property }] : g.members.filter((m) => !(m.ieee === ieee && m.property === property)) });
  const save = async () => {
    setError('');
    try {
      if (g.id) await api('PUT', `/api/sensor-groups/${g.id}`, g);
      else await api('POST', '/api/sensor-groups', g);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  const remove = async () => {
    if (!g.id || !window.confirm(`Delete the sensor group "${g.name}"? Automations and checks using it will show a warning.`)) return;
    try {
      await api('DELETE', `/api/sensor-groups/${g.id}`);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  return (
    <div className="card card-body mb-3">
      <h2>{g.id ? 'Edit sensor group' : 'New sensor group'}</h2>
      <label>
        Name
        <input className="form-control form-control-sm" value={g.name} maxLength={60} placeholder="e.g. Windows" onChange={(e) => setG({ ...g, name: e.target.value })} />
      </label>
      <h3 className="h6">Sensors</h3>
      <p className="small text-body-secondary mb-1">Choose sensors of one kind, such as all window contacts. Mixed kinds read as plain on/off.</p>
      <div className="mb-3" style={{ maxHeight: '18rem', overflowY: 'auto' }}>
        {sensors.length === 0 && <p className="muted small">No yes/no sensors yet.</p>}
        {sensors.map((s) => (
          <label key={`${s.ieee}:${s.property}`} className="line mb-1">
            <input className="form-check-input" type="checkbox" checked={has(s.ieee, s.property)} onChange={(e) => toggle(s.ieee, s.property, e.target.checked)} />
            {s.label}
          </label>
        ))}
      </div>
      <h3 className="h6">Words</h3>
      <p className="small text-body-secondary mb-1">Your words for a sensor's two states. Empty: the sensor's own ("open" / "closed", "wet" / "dry"…).</p>
      <div className="line mb-3">
        <input className="form-control form-control-sm" style={{ maxWidth: '12rem' }} maxLength={30} placeholder="active, e.g. open" aria-label="Word when active" value={g.labels.active} onChange={(e) => setG({ ...g, labels: { ...g.labels, active: e.target.value } })} />
        <input className="form-control form-control-sm" style={{ maxWidth: '12rem' }} maxLength={30} placeholder="not active, e.g. closed" aria-label="Word when not active" value={g.labels.inactive} onChange={(e) => setG({ ...g, labels: { ...g.labels, inactive: e.target.value } })} />
      </div>
      <h3 className="h6">In the app</h3>
      <div className="line mb-3">
        <label className="line mb-0">
          <input className="form-check-input" type="checkbox" checked={g.tile} onChange={(e) => setG({ ...g, tile: e.target.checked })} />
          Show as a tile in
        </label>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} aria-label="Room" value={g.roomId ?? ''} onChange={(e) => setG({ ...g, roomId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Other (no room)</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {g.id && g.tile ? <MemberAccess kind="tile" id={`sensors:${g.id}`} /> : null}
      <div className="line mt-3">
        <button className="btn btn-primary btn-sm" onClick={() => void save()}>
          Save
        </button>
        <button className="btn btn-outline-secondary btn-sm" onClick={onDone}>
          Cancel
        </button>
        {g.id && (
          <button className="btn btn-outline-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-danger mt-2 mb-0">{error}</p>}
    </div>
  );
}
