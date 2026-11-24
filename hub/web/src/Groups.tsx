import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Choices, type ChoiceDevice, type DeviceRow, type LightGroup } from './api';
import { byRoom } from './byRoom';
import { useApi } from './useApi';
import { Icon } from './Icons';
import { GroupLightState } from './LightState';
import { confirmDelete, ItemLink, useHashId } from './Related';
import { ItemRooms, RoomSections, useRooms } from './RoomSections';
import { featureFor, featureUI } from './features';
import { withLightOn } from '../../src/features/index.js';

// Light groups: one Zigbee command for several bulbs, such as "Living room lights".

export function Groups() {
  const [groups, setGroups] = useState<LightGroup[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [editing, setEditing] = useState<{ id?: number; name: string; members: string[]; create: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const { rooms, membership } = useRooms(groups);
  // Lights that can be in a group: devices with an on/off and a brightness or colour (from their capabilities).
  const choices = useApi<Choices>('/api/rule-choices');
  const lights = (choices.data?.devices ?? []).filter(isLight);
  const [focus] = useHashId();
  useEffect(() => {
    if (focus && groups) document.getElementById(`group-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, groups]);

  const load = useCallback(() => {
    api<LightGroup[]>('GET', '/api/groups').then(setGroups, (e: ApiError) => setMessage({ text: e.message, error: true }));
    api<DeviceRow[]>('GET', '/api/devices').then(setDevices, () => undefined);
  }, []);
  useEffect(load, [load]);
  // The groups' light states follow the lights.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') api<LightGroup[]>('GET', '/api/groups').then(setGroups, () => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const call = async (fn: () => Promise<unknown>, ok?: string) => {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ text: ok, error: false });
      load();
      return true;
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
      return false;
    }
  };

  const save = async () => {
    if (!editing) return;
    const members = editing.members.map((ieee) => ({ ieee }));
    const done = await call(() =>
      editing.id === undefined
        ? api('POST', '/api/groups', { name: editing.name, members })
        : editing.create
          ? api('POST', `/api/groups/${editing.id}/create`, { members })
          : api('PUT', `/api/groups/${editing.id}/members`, { members }),
    );
    if (done) setEditing(null);
  };

  const joined = devices.filter((d) => d.status === 'joined');
  const setMembers = (g: LightGroup, ieees: string[], ok: string) => call(() => api('PUT', `/api/groups/${g.id}/members`, { members: ieees.map((ieee) => ({ ieee })) }), ok);
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Light groups</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', members: [], create: true })}>
          New group
        </button>
      </div>
      <p className="muted">A group switches several lights with one Zigbee message, so they change together. Use it in actions and rules.</p>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      {editing && (
        <div className="step">
          {editing.id === undefined ? (
            <label>
              Name
              <input className="form-control form-control-sm" value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
          ) : (
            <strong>{editing.name}</strong>
          )}
          <p className="muted small">Devices in the group (only devices that have moved can be chosen):</p>
          {lights.length === 0 && <p className="muted small">No lights have joined yet.</p>}
          {byRoom(lights).map(([room, list]) => (
            <fieldset key={room} className="mb-2">
              <legend className="small fw-semibold mb-1">{room}</legend>
              {list.map((d) => (
                <label key={d.ieee} className="line">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    disabled={d.status !== 'joined'}
                    checked={editing.members.includes(d.ieee)}
                    onChange={(e) => setEditing({ ...editing, members: e.target.checked ? [...editing.members, d.ieee] : editing.members.filter((x) => x !== d.ieee) })}
                  />
                  <Icon name={d.icon ?? 'lightbulb'} />
                  <ItemLink kind="device" id={d.ieee}>
                    {d.name}
                  </ItemLink>
                  {d.status !== 'joined' && <span className="muted"> (not moved yet)</span>}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="line">
            <button className="btn btn-primary btn-sm" disabled={editing.members.length === 0} onClick={() => void save()}>
              {editing.create ? 'Create the group' : 'Save members'}
            </button>
            <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {groups && groups.length === 0 && <p className="muted">No groups yet.</p>}
      <RoomSections
        className="list"
        items={groups ?? []}
        rooms={rooms}
        roomsOf={(g) => membership?.groups?.[String(g.id)] ?? []}
        render={(g, inRooms) => {
          const plannedReady = g.plannedMembers.length > 0 && g.plannedMembers.every((m) => joined.some((d) => d.ieee === m.ieee));
          return (
            <div className={`card${focus === String(g.id) ? ' highlight' : ''}`} key={g.id} id={`group-${g.id}`}>
              <strong>
                <span className="device-icon">
                  <Icon name="light_group" />
                </span>
                {g.name}
              </strong>{' '}
              <GroupLightState words={g.light} />
              <ItemRooms ids={inRooms} rooms={rooms} />
              {g.created ? (
                <span className="line small">
                  {g.members.length === 0 && <span className="muted">no devices</span>}
                  {g.members.map((m) => (
                    <span key={`${m.ieee}/${m.endpoint}`} className="badge rounded-pill text-bg-light border d-inline-flex align-items-center gap-1">
                      <ItemLink kind="device" id={m.ieee}>
                        {m.name ?? m.ieee}
                      </ItemLink>
                      <button
                        className="btn btn-link btn-sm p-0 text-secondary"
                        aria-label={`Remove ${m.name ?? m.ieee} from ${g.name}`}
                        title="Remove from the group"
                        onClick={() => {
                          if (window.confirm(`Remove ${m.name ?? m.ieee} from ${g.name}? It stays in SynBee and can still be switched on its own.`)) {
                            void setMembers(g, g.members.filter((x) => x.ieee !== m.ieee).map((x) => x.ieee), `${m.name ?? m.ieee} removed from ${g.name}.`);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {lights.some((d) => d.status === 'joined' && !g.members.some((m) => m.ieee === d.ieee)) && (
                    <select
                      className="form-select form-select-sm"
                      style={{ width: 'auto' }}
                      aria-label={`Add a light to ${g.name}`}
                      value=""
                      onChange={(e) => {
                        const d = lights.find((x) => x.ieee === e.target.value);
                        if (d) void setMembers(g, [...g.members.map((x) => x.ieee), d.ieee], `${d.name} added to ${g.name}.`);
                      }}
                    >
                      <option value="">Add a light…</option>
                      {byRoom(lights.filter((d) => d.status === 'joined' && !g.members.some((m) => m.ieee === d.ieee))).map(([room, list]) => (
                        <optgroup key={room} label={room}>
                          {list.map((d) => (
                            <option key={d.ieee} value={d.ieee}>
                              {d.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </span>
              ) : (
                <span className="badge rounded-pill text-bg-warning">not created yet</span>
              )}
              {g.note && !g.created && <span className="muted small">{g.note}</span>}
              {!g.created && g.plannedMembers.length > 0 && (
                <span className="line small">
                  Likely:{' '}
                  {g.plannedMembers.map((m) => (
                    <ItemLink key={m.ieee} kind="device" id={m.ieee}>
                      {m.name ?? m.ieee}
                    </ItemLink>
                  ))}
                </span>
              )}
              {g.created && g.properties.length > 0 && (
                <div className="group-controls">
                  {g.properties
                    .filter((p) => p.writable)
                    .map((p) => {
                      const ui = featureUI(p);
                      return (
                        <div className="line" key={p.property}>
                          <span className="small muted" style={{ minWidth: '6rem' }}>
                            {featureFor(p).label}
                          </span>
                          <ui.Control prop={p} value={undefined} onSend={(values) => void call(() => api('POST', `/api/groups/${g.id}/command`, withLightOn(g.properties, values)))} />
                        </div>
                      );
                    })}
                </div>
              )}
              {!g.created && plannedReady && <span className="text-success small">All its likely bulbs have moved: it can be created now.</span>}
              <div className="line">
                {g.created ? (
                  <>
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing({ id: g.id, name: g.name, members: g.members.map((m) => m.ieee), create: false })}>Members</button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setEditing({ id: g.id, name: g.name, members: g.plannedMembers.filter((m) => joined.some((d) => d.ieee === m.ieee)).map((m) => m.ieee), create: true })}
                  >
                    Create…
                  </button>
                )}
                <button className="btn btn-outline-secondary btn-sm" onClick={() => void confirmDelete('group', g.id, g.name).then((ok) => ok && call(() => api('DELETE', `/api/groups/${g.id}`)))}>Delete</button>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

/** A device that can be in a light group: it switches on and off and has a brightness or a colour. */
function isLight(d: ChoiceDevice): boolean {
  const props = d.properties.filter((p) => p.writable).map((p) => p.property);
  return props.includes('state') && (props.includes('brightness') || props.includes('color') || props.includes('color_temp'));
}
