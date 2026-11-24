import { useState } from 'react';
import { api, ApiError, type DeviceRow, type Room } from '../api';
import { Icon } from '../Icons';
import { LightState } from '../LightState';
import { ItemLink, RoomChips, useHashId } from '../Related';
import { roomColors, RoomPhoto, roomStyle } from '../roomStyle';
import { useApi } from '../useApi';
import { AttentionCard } from './AttentionCard';
import { EnergyTotal } from '../history/EnergyTotal';
import { DeviceView } from './DeviceView';
import { DeviceRoomMenu, MoveTo } from './RoomPickers';

// The Devices page: devices grouped by room, with moving and adding to rooms in bulk.
export function Devices() {
  // Refreshed so light states and offline marks follow the devices.
  const devicesApi = useApi<DeviceRow[]>('/api/devices', { refreshMs: 8000 });
  const roomsApi = useApi<Room[]>('/api/rooms');
  const devices = devicesApi.data;
  const rooms = roomsApi.data ?? [];
  const [selected, setSelected] = useHashId();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const load = () => {
    devicesApi.reload();
    roomsApi.reload();
  };
  const run = (p: Promise<unknown>) =>
    void p.then(
      () => (setPicked(new Set()), load()),
      (e: ApiError) => setError(e.message),
    );

  if (selected) return <DeviceView key={selected} ieee={selected} onBack={() => (setSelected(null), load())} />;
  // Grouped by main room, in the rooms' order; a device also shown in other rooms appears there too, marked.
  // Devices with no main room come last, under "Not assigned".
  const sections: Array<{ room: Room | null; rows: Array<{ d: DeviceRow; also: boolean }> }> = rooms.map((r) => ({
    room: r,
    rows: (devices ?? []).filter((d) => d.roomId === r.id || d.alsoRooms?.includes(r.id)).map((d) => ({ d, also: d.roomId !== r.id })),
  }));
  sections.push({ room: null, rows: (devices ?? []).filter((d) => d.roomId == null).map((d) => ({ d, also: false })) });
  const colors = roomColors(rooms);
  return (
    <div className="card card-body mb-3">
      <AttentionCard />
      <EnergyTotal />
      <h2>Devices</h2>
      {(error || devicesApi.error) && <p className="text-danger">{error || devicesApi.error}</p>}
      {devices && devices.length === 0 && <p className="muted">No devices yet. Import from Tuya, or add devices.</p>}
      {picked.size > 0 && (
        <div className="line bulk">
          <strong>{picked.size} selected</strong>
          <MoveTo rooms={rooms} label="Move to room…" onPick={(room) => run(api('POST', '/api/rooms/move', { devices: [...picked], room }))} />
          <MoveTo rooms={rooms} label="Add to room…" onPick={(room) => run(api('POST', '/api/rooms/add', { devices: [...picked], room }))} />
          <button className="btn btn-outline-secondary btn-sm" onClick={() => run(api('POST', '/api/rooms/move', { devices: [...picked], room: null }))}>Remove from room</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      {sections
        .filter((s) => s.rows.length > 0)
        .map(({ room, rows }) => (
          <section key={room?.id ?? 'none'} className="room-section" style={roomStyle(room ? colors.get(room.id) : undefined)}>
            <h3 className="line">
              {room && <RoomPhoto room={room} />}
              <Icon name={room?.icon ?? 'help_center'} />
              {room ? (
                <ItemLink kind="room" id={room.id}>
                  {room.name}
                </ItemLink>
              ) : (
                'Not assigned'
              )}
            </h3>
            <div className="table-wrap">
              <table className="table table-sm align-middle">
                <tbody>
                  {rows.map(({ d, also }) => (
                    <tr key={d.ieee}>
                      <td style={{ width: '2rem' }}>
                        <input className="form-check-input"
                          type="checkbox"
                          aria-label={`Select ${d.name}`}
                          checked={picked.has(d.ieee)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(d.ieee);
                            else next.delete(d.ieee);
                            setPicked(next);
                          }}
                        />
                      </td>
                      <td>
                        <ItemLink kind="device" id={d.ieee}>
                          <span className="device-icon">
                            <Icon name={d.icon ?? 'question_mark'} />
                          </span>
                          {d.name}
                        </ItemLink>
                        <RoomChips roomId={d.roomId} alsoRooms={d.alsoRooms} rooms={rooms} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <LightState light={d.light} />{' '}
                        <span className="badge rounded-pill text-bg-light border">{d.status === 'pending' ? 'not moved yet' : 'paired'}</span>
                        {d.online === false && <span className="badge rounded-pill text-bg-warning">offline</span>}{' '}
                        <DeviceRoomMenu device={d} room={room} rooms={rooms} onDone={load} onError={setError} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}

/** A room chooser that ends with "New room…". */
