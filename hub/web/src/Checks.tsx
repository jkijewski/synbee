import { useState } from 'react';
import { api, type ApiError, type Check, type Choices, type TileLevel } from './api';
import { ConditionEditor } from './rules/ConditionEditor';
import { defaultCondition, Item } from './rules/RuleParts';
import { MemberAccess } from './MemberAccess';
import { useRooms } from './RoomSections';
import { LEVEL_BADGE } from './SensorGroups';
import { useApi } from './useApi';

// Checks (plan: checks and alerts): named statements you define from the same conditions as an automation's IF, true
// or false, with your own words and level for each side. Used by the app's tiles, automations (WHEN and IF) and
// actions' "Only when", which then says "Not run: "<check>" isn't true".

const LEVELS: Array<[TileLevel, string]> = [
  ['fine', 'Fine (green)'],
  ['info', 'Info (grey)'],
  ['warning', 'Warning (orange)'],
  ['alarm', 'Alarm (red)'],
];

const blank = (): Check => ({
  name: '',
  if: { mode: 'all', conditions: [] },
  whenTrue: { text: '', level: 'fine' },
  whenFalse: { text: '', level: 'warning' },
  roomId: null,
  tile: true,
});

export function ChecksPage() {
  const list = useApi<Check[]>('/api/checks', { refreshMs: 10000 });
  const [editing, setEditing] = useState<Check | null>(null);
  const { rooms } = useRooms();
  if (editing) return <CheckEditor initial={editing} rooms={rooms} onDone={() => (setEditing(null), list.reload())} />;
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Checks</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(blank())}>
          New check
        </button>
      </div>
      <p className="small text-body-secondary">
        A check is a statement you define, such as "Windows closed" or "OK to heat", built from conditions. It is true or false, and you choose what each
        means and how it looks. Use it as a tile in the app, in automations ("WHEN check becomes false for 10 min"), and in an action's "Only when".
      </p>
      {list.data?.length === 0 && <p className="muted">No checks yet.</p>}
      <div className="list">
        {list.data?.map((c) => (
          <div className="card" key={c.id}>
            <div className="line">
              <strong style={{ marginRight: 'auto' }}>{c.name}</strong>
              {c.now && <span className={`badge rounded-pill ${LEVEL_BADGE[c.now.level]}`}>{c.now.text}</span>}
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(c)}>
                Edit
              </button>
            </div>
            {c.now && c.now.why.length > 0 && <div className="small muted">Because: {c.now.why.map((w) => w.text).join(' · ')}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SideEditor({ label, value, onChange }: { label: string; value: Check['whenTrue']; onChange: (v: Check['whenTrue']) => void }) {
  return (
    <div className="line mb-2">
      <span style={{ minWidth: '6rem' }}>{label}</span>
      <input className="form-control form-control-sm" style={{ maxWidth: '20rem' }} maxLength={80} placeholder="What it means, in your words" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      <select className="form-select form-select-sm" style={{ width: 'auto' }} aria-label={`${label} level`} value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value as TileLevel })}>
        {LEVELS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckEditor({ initial, rooms, onDone }: { initial: Check; rooms: Array<{ id: number; name: string }>; onDone: () => void }) {
  const [c, setC] = useState(initial);
  const [error, setError] = useState('');
  const choices = useApi<Choices>('/api/rule-choices');
  const save = async () => {
    setError('');
    const { now: _now, ...body } = c;
    try {
      if (c.id) await api('PUT', `/api/checks/${c.id}`, body);
      else await api('POST', '/api/checks', body);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  const remove = async () => {
    if (!c.id || !window.confirm(`Delete the check "${c.name}"? Automations and actions using it will show a warning.`)) return;
    try {
      await api('DELETE', `/api/checks/${c.id}`);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  return (
    <div className="card card-body mb-3">
      <h2>{c.id ? 'Edit check' : 'New check'}</h2>
      <label>
        Name
        <input className="form-control form-control-sm" value={c.name} maxLength={60} placeholder="e.g. Windows closed" onChange={(e) => setC({ ...c, name: e.target.value })} />
      </label>
      <div className="card card-body mb-3 card-if">
        <h3>True when</h3>
        {c.if.conditions.length > 1 && (
          <select className="form-select form-select-sm mb-2" style={{ width: 'auto' }} aria-label="Combine conditions" value={c.if.mode} onChange={(e) => setC({ ...c, if: { ...c.if, mode: e.target.value as 'all' | 'any' } })}>
            <option value="all">All of these are true</option>
            <option value="any">Any of these is true</option>
          </select>
        )}
        {choices.data &&
          c.if.conditions.map((x, i) => (
            <Item key={i} onRemove={() => setC({ ...c, if: { ...c.if, conditions: c.if.conditions.filter((_, j) => j !== i) } })}>
              <ConditionEditor noChecks condition={x} choices={choices.data!} onChange={(n) => setC({ ...c, if: { ...c.if, conditions: c.if.conditions.map((y, j) => (j === i ? n : y)) } })} />
            </Item>
          ))}
        {choices.data && (
          <button className="btn btn-outline-secondary btn-sm align-self-start" onClick={() => setC({ ...c, if: { ...c.if, conditions: [...c.if.conditions, defaultCondition(choices.data!)] } })}>
            Add condition
          </button>
        )}
      </div>
      <h3 className="h6">What it means</h3>
      <SideEditor label="When true" value={c.whenTrue} onChange={(whenTrue) => setC({ ...c, whenTrue })} />
      <SideEditor label="When false" value={c.whenFalse} onChange={(whenFalse) => setC({ ...c, whenFalse })} />
      <h3 className="h6 mt-2">In the app</h3>
      <div className="line mb-3">
        <label className="line mb-0">
          <input className="form-check-input" type="checkbox" checked={c.tile} onChange={(e) => setC({ ...c, tile: e.target.checked })} />
          Show as a tile in
        </label>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} aria-label="Room" value={c.roomId ?? ''} onChange={(e) => setC({ ...c, roomId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Other (no room)</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {c.id && c.tile ? <MemberAccess kind="tile" id={`check:${c.id}`} /> : null}
      <div className="line mt-3">
        <button className="btn btn-primary btn-sm" onClick={() => void save()}>
          Save
        </button>
        <button className="btn btn-outline-secondary btn-sm" onClick={onDone}>
          Cancel
        </button>
        {c.id && (
          <button className="btn btn-outline-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-danger mt-2 mb-0">{error}</p>}
    </div>
  );
}
