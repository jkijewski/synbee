import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type DeviceRow, type Room } from './api';
import { Icon, IconPicker, ROOM_ICONS } from './Icons';
import { DeviceRoomMenu } from './devices/RoomPickers';
import { MemberAccess } from './MemberAccess';
import { PALETTE, preparePhoto, roomColors, RoomPhoto, roomStyle } from './roomStyle';
import { ItemLink, RoomChips, useHashId } from './Related';

// Rooms group devices (0012). Each device has one main room; showing it in more rooms is set on the device page.

export function Rooms() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [devices, setDevices] = useState<Record<string, DeviceRow>>({});
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ room: number; picked: string[] } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [focus] = useHashId();
  useEffect(() => {
    if (focus && rooms) document.getElementById(`room-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, rooms]);
  const fail = (text: string) => setMessage({ text, error: true });
  const colors = roomColors(rooms ?? []);

  const load = useCallback(() => {
    api<Room[]>('GET', '/api/rooms').then(setRooms, (e: ApiError) => setMessage({ text: e.message, error: true }));
    api<DeviceRow[]>('GET', '/api/devices').then((rows) => setDevices(Object.fromEntries(rows.map((d) => [d.ieee, d]))), () => undefined);
  }, []);
  useEffect(load, [load]);

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
  const move = (i: number, by: number) => {
    if (!rooms) return;
    const ids = rooms.map((r) => r.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + by, 0, id!);
    void call(() => api('PUT', '/api/rooms/order', { order: ids }));
  };
  const remove = (room: Room, others: Room[]) => {
    const count = room.devices.length;
    let moveTo: number | null = null;
    if (count > 0 && others.length > 0) {
      const answer = prompt(
        `"${room.name}" is the main room of ${count} device${count === 1 ? '' : 's'}. Type the name of the room to move them to, or leave empty for no room:\n${others.map((r) => r.name).join(', ')}`,
        '',
      );
      if (answer === null) return;
      if (answer.trim()) {
        const target = others.find((r) => r.name.toLowerCase() === answer.trim().toLowerCase());
        if (!target) return setMessage({ text: `There is no room called "${answer.trim()}".`, error: true });
        moveTo = target.id;
      }
    } else if (!confirm(`Delete the room "${room.name}"?`)) return;
    void call(() => api('DELETE', `/api/rooms/${room.id}`, { moveTo }));
  };

  return (
    <div className="card card-body mb-3">
      <h2>Rooms</h2>
      <p className="muted">Every device has one main room. A device can also be shown in more rooms from its page, under "Also show in other rooms".</p>
      <div className="line">
        <input className="form-control form-control-sm" aria-label="New room name" placeholder="New room, e.g. salon" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={() => void call(() => api('POST', '/api/rooms', { name }), 'Room added.').then((ok) => ok && setName(''))}>
          Add room
        </button>
      </div>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      {rooms && rooms.length === 0 && <p className="muted">No rooms yet.</p>}
      <div className="list">
        {rooms?.map((room, i) => {
          const color = colors.get(room.id) ?? '#888888';
          const lights = room.devices.filter((ieee) => devices[ieee]?.status === 'joined' && devices[ieee]?.icon === 'lightbulb').length;
          return (
            <div className={`card room-card${focus === String(room.id) ? ' highlight' : ''}`} key={room.id} id={`room-${room.id}`} style={roomStyle(color)}>
              <div className="line">
                <RoomPhoto room={room} size={64} />
                <span className="device-icon">
                  <Icon name={room.icon} size="1.8rem" />
                </span>
                <RoomName room={room} onSave={(n) => call(() => api('PATCH', `/api/rooms/${room.id}`, { name: n }))} />
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  {room.devices.length} device{room.devices.length === 1 ? '' : 's'}
                  {room.alsoDevices.length > 0 && `, ${room.alsoDevices.length} also shown here`}
                </span>
              </div>
              <div className="line small">
                {[...room.devices, ...room.alsoDevices].map((ieee) => (
                  <span key={ieee} className="line chip" style={{ gap: '0.2rem' }}>
                    <ItemLink kind="device" id={ieee}>
                      <Icon name={devices[ieee]?.icon ?? 'question_mark'} /> {devices[ieee]?.name ?? ieee}
                    </ItemLink>
                    {devices[ieee] && <RoomChips roomId={devices[ieee]!.roomId} alsoRooms={devices[ieee]!.alsoRooms} rooms={rooms} />}
                    {devices[ieee] && <DeviceRoomMenu device={devices[ieee]!} room={room} rooms={rooms} onDone={load} onError={fail} />}
                  </span>
                ))}
              </div>
              <RoomRelated room={room} refresh={devices} />
              <MemberAccess kind="room" id={room.id} />
              <div className="line">
                <button className="btn btn-outline-secondary btn-sm" aria-label={`Move ${room.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="btn btn-outline-secondary btn-sm" aria-label={`Move ${room.name} down`} disabled={i === rooms.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setAdding(adding?.room === room.id ? null : { room: room.id, picked: [] })}>Add devices…</button>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(editing === room.id ? null : room.id)}>Icon and colour</button>
                <RoomPhotoControls room={room} onDone={load} onError={fail} />
                {lights >= 2 && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => void call(() => api('POST', `/api/rooms/${room.id}/light-group`), `Light group "${room.name}" created.`)}>
                    Make a light group of its {lights} lights
                  </button>
                )}
                <button className="btn btn-outline-secondary btn-sm" onClick={() => remove(room, rooms.filter((r) => r.id !== room.id))}>Delete</button>
              </div>
              {adding?.room === room.id && (
                <div className="step">
                  <p className="muted small">
                    Devices with a main room keep it and are also shown here; devices without one get this as their main room.
                  </p>
                  {Object.values(devices)
                    .filter((d) => d.roomId !== room.id && !(d.alsoRooms ?? []).includes(room.id))
                    .map((d) => (
                      <label key={d.ieee} className="line">
                        <input className="form-check-input"
                          type="checkbox"
                          checked={adding.picked.includes(d.ieee)}
                          onChange={(e) =>
                            setAdding({ ...adding, picked: e.target.checked ? [...adding.picked, d.ieee] : adding.picked.filter((x) => x !== d.ieee) })
                          }
                        />
                        <Icon name={d.icon ?? 'question_mark'} /> {d.name}
                        <span className="muted small">{d.room ? `(in ${d.room})` : '(not assigned)'}</span>
                      </label>
                    ))}
                  <div className="line">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={adding.picked.length === 0}
                      onClick={() => void call(() => api('POST', '/api/rooms/add', { devices: adding.picked, room: room.id }), 'Added.').then((ok) => ok && setAdding(null))}
                    >
                      Add {adding.picked.length || ''} to {room.name}
                    </button>
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => setAdding(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {editing === room.id && <RoomColor room={room} current={color} onPick={(c) => void call(() => api('PATCH', `/api/rooms/${room.id}`, { color: c }))} />}
              {editing === room.id && (
                <IconPicker
                  value={room.icon}
                  suggestions={ROOM_ICONS}
                  onPick={(icon) => icon && void call(() => api('PATCH', `/api/rooms/${room.id}`, { icon })).then(() => setEditing(null))}
                />
              )}
            </div>
          );
        })}
        {Object.values(devices).some((d) => d.roomId == null) && (
          <div className="card">
            <div className="line">
              <span className="device-icon">
                <Icon name="help_center" size="1.8rem" />
              </span>
              <strong>Not assigned</strong>
            </div>
            <div className="line small">
              {Object.values(devices)
                .filter((d) => d.roomId == null)
                .map((d) => (
                  <span key={d.ieee} className="line chip" style={{ gap: '0.2rem' }}>
                    <ItemLink kind="device" id={d.ieee}>
                      <Icon name={d.icon ?? 'question_mark'} /> {d.name}
                    </ItemLink>
                    <DeviceRoomMenu device={d} room={null} rooms={rooms ?? []} onDone={load} onError={fail} />
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface RoomRelatedData {
  groups: Array<{ id: number; name: string; devices: string[] }>;
  actions: Array<{ id: number; name: string; draft: boolean; devices: string[] }>;
  rules: Array<{ id: number; name: string; enabled: boolean; draft: boolean; devices: string[] }>;
}

/** The light groups, actions and automations that use this room's devices, one per line. */
function RoomRelated({ room, refresh }: { room: Room; refresh: unknown }) {
  const [data, setData] = useState<RoomRelatedData | null>(null);
  useEffect(() => {
    api<RoomRelatedData>('GET', `/api/rooms/${room.id}/related`).then(setData, () => setData(null));
  }, [room.id, refresh]);
  if (!data) return null;
  const section = <T extends { id: number; name: string; devices: string[] }>(
    title: string,
    kind: 'group' | 'action' | 'rule',
    icon: string,
    list: T[],
    badge: (x: T) => React.ReactNode,
  ) =>
    list.length > 0 && (
      <div className="room-list">
        <h4>
          {title} <span className="muted">({list.length})</span>
        </h4>
        <ul>
          {list.map((x) => (
            <li key={x.id}>
              <Icon name={icon} />{' '}
              <ItemLink kind={kind} id={x.id}>
                {x.name}
              </ItemLink>
              {badge(x)} <span className="muted small">via {x.devices.join(', ')}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="related">
      {section('Light groups', 'group', 'light_group', data.groups, () => null)}
      {section('Actions', 'action', 'bolt', data.actions, (a) => a.draft && <span className="badge rounded-pill text-bg-warning">draft</span>)}
      {section('Automations', 'rule', 'schema', data.rules, (r) => (r.draft ? <span className="badge rounded-pill text-bg-warning">draft</span> : !r.enabled && <span className="badge rounded-pill text-bg-light border">disabled</span>))}
    </div>
  );
}

/** Colour swatches, a custom colour and "Automatic". */
function RoomColor({ room, current, onPick }: { room: Room; current: string; onPick: (color: string | null) => void }) {
  return (
    <div className="swatches">
      {PALETTE.map((c) => (
        <button key={c} className={`swatch${room.color === c ? ' selected' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => onPick(c)} />
      ))}
      <label className="line small">
        own
        <input className="form-control form-control-color" type="color" value={current} onChange={(e) => onPick(e.target.value)} aria-label="Choose your own colour" />
      </label>
      <button className={room.color ? '' : 'selected'} onClick={() => onPick(null)}>
        Automatic
      </button>
    </div>
  );
}

/** Upload, replace or remove a room's photo. It's scaled in the browser first. */
function RoomPhotoControls({ room, onDone, onError }: { room: Room; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <span className="line small">
      <label className="btn btn-outline-secondary btn-sm mb-0">
        {busy ? 'Uploading…' : room.photo ? 'Replace photo' : 'Add photo'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          hidden
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            try {
              await api('PUT', `/api/rooms/${room.id}/photo`, await preparePhoto(file));
              onDone();
            } catch (err) {
              onError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {room.photo && <button className="btn btn-outline-secondary btn-sm" onClick={() => void api('DELETE', `/api/rooms/${room.id}/photo`).then(onDone, (e: ApiError) => onError(e.message))}>Remove photo</button>}
    </span>
  );
}

function RoomName({ room, onSave }: { room: Room; onSave: (name: string) => Promise<boolean> }) {
  const [value, setValue] = useState(room.name);
  useEffect(() => setValue(room.name), [room.name]);
  return (
    <span className="line">
      <input className="form-control form-control-sm" aria-label="Room name" value={value} maxLength={100} onChange={(e) => setValue(e.target.value)} style={{ fontWeight: 600 }} />
      {value.trim() !== room.name && value.trim() && <button className="btn btn-outline-secondary btn-sm" onClick={() => void onSave(value.trim())}>Rename</button>}
    </span>
  );
}
