import { useEffect, useRef } from 'react';
import { api, ApiError, type DeviceRow, type Room } from '../api';


// Choosing rooms for devices: move to, add to, and the main-room select.
export function MoveTo({ rooms, label, onPick, exclude }: { rooms: Room[]; label: string; onPick: (room: number) => void; exclude?: number | null }) {
  return (
    <select className="form-select form-select-sm"
      aria-label={label}
      value=""
      onChange={async (e) => {
        const v = e.target.value;
        if (v === 'new') {
          const name = prompt('Name of the new room');
          if (!name?.trim()) return;
          try {
            onPick((await api<Room>('POST', '/api/rooms', { name })).id);
          } catch (err) {
            alert((err as ApiError).message);
          }
        } else if (v) onPick(Number(v));
      }}
    >
      <option value="">{label}</option>
      {rooms
        .filter((r) => r.id !== exclude)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      <option value="new">New room…</option>
    </select>
  );
}

/** The small menu next to a device in a room: move it to another main room, or take it out of this room. */
export function DeviceRoomMenu({
  device,
  room,
  rooms,
  onDone,
  onError,
}: {
  device: Pick<DeviceRow, 'ieee' | 'name' | 'roomId' | 'alsoRooms'>;
  room: Room | null;
  rooms: Room[];
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Closes when clicking anywhere else, like a normal menu.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const run = (p: Promise<unknown>) => void p.then(() => (ref.current && (ref.current.open = false), onDone()), (e: ApiError) => onError(e.message));
  const extra = room !== null && device.roomId !== room.id;
  return (
    <details className="menu" ref={ref}>
      <summary className="btn btn-outline-secondary btn-sm" aria-label={`Room options for ${device.name}`}>
        ⋯
      </summary>
      <div className="menu-body dropdown-menu show shadow">
        <MoveTo rooms={rooms} exclude={device.roomId} label="Move to room…" onPick={(r) => run(api('POST', '/api/rooms/move', { devices: [device.ieee], room: r }))} />
        <MoveTo
          rooms={rooms.filter((r) => !(device.alsoRooms ?? []).includes(r.id))}
          exclude={device.roomId}
          label="Add to room…"
          onPick={(r) => run(api('POST', '/api/rooms/add', { devices: [device.ieee], room: r }))}
        />
        {room && (
          <button className="btn btn-outline-secondary btn-sm" onClick={() => run(api('DELETE', `/api/rooms/${room.id}/devices/${device.ieee}`))}>
            {extra ? `Stop showing in ${room.name}` : `Remove from ${room.name}`}
          </button>
        )}
      </div>
    </details>
  );
}

/** The device's main room: a plain choice of one room, or a new one. */
export function RoomSelect({ rooms, value, onChange }: { rooms: Room[]; value: number | null; onChange: (room: number | null) => void }) {
  return (
    <select className="form-select form-select-sm"
      aria-label="Room"
      value={value ?? ''}
      onChange={async (e) => {
        if (e.target.value === 'new') {
          const name = prompt('Name of the new room');
          if (!name?.trim()) return;
          try {
            const room = await api<Room>('POST', '/api/rooms', { name });
            onChange(room.id);
          } catch (err) {
            alert((err as ApiError).message);
          }
          return;
        }
        onChange(e.target.value === '' ? null : Number(e.target.value));
      }}
    >
      <option value="">Not assigned</option>
      {rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
      <option value="new">New room…</option>
    </select>
  );
}
