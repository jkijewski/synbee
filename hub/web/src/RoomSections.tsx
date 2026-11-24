import { useEffect, useState } from 'react';
import { api, type Room } from './api';
import { Icon } from './Icons';
import { ItemLink } from './Related';
import { roomColors, RoomPhoto, roomStyle } from './roomStyle';

// Lists actions or automations grouped by room, like the device list (0012). They have no room of their own: an item
// is under every room of the devices it uses, and under "Not assigned" when it uses none.

export interface Membership {
  actions: Record<string, number[]>;
  rules: Record<string, number[]>;
  groups?: Record<string, number[]>;
}

export function useRooms(refresh?: unknown): { rooms: Room[]; membership: Membership | null } {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  useEffect(() => {
    api<Room[]>('GET', '/api/rooms').then(setRooms, () => undefined);
    api<Membership>('GET', '/api/rooms/membership').then(setMembership, () => undefined);
  }, [refresh]);
  return { rooms, membership };
}

/** The rooms an action or automation is in, as linked chips, when there is more than one. */
export function ItemRooms({ ids, rooms }: { ids: number[]; rooms: Room[] }) {
  if (ids.length < 2) return null;
  const colors = roomColors(rooms);
  return (
    <span className="room-chips">
      {ids.map((id) => (
        <ItemLink key={id} kind="room" id={id}>
          <span className="badge rounded-pill room-chip" style={roomStyle(colors.get(id))}>
            {rooms.find((r) => r.id === id)?.name ?? id}
          </span>
        </ItemLink>
      ))}
    </span>
  );
}

export function RoomSections<T extends { id?: number }>({
  items,
  rooms,
  roomsOf,
  render,
  className = 'grid',
}: {
  items: T[];
  rooms: Room[];
  roomsOf: (item: T) => number[];
  render: (item: T, inRooms: number[]) => React.ReactNode;
  className?: string;
}) {
  const sections = rooms.map((room) => ({ room, list: items.filter((i) => roomsOf(i).includes(room.id)) }));
  const none = items.filter((i) => roomsOf(i).length === 0);
  const colors = roomColors(rooms);
  return (
    <>
      {sections
        .filter((s) => s.list.length > 0)
        .map(({ room, list }) => (
          <section key={room.id} className="room-section" style={roomStyle(colors.get(room.id))}>
            <h3 className="line">
              <RoomPhoto room={room} />
              <Icon name={room.icon} />
              <ItemLink kind="room" id={room.id}>
                {room.name}
              </ItemLink>
            </h3>
            <div className={className}>{list.map((i) => render(i, roomsOf(i)))}</div>
          </section>
        ))}
      {none.length > 0 && (
        <section className="room-section">
          <h3 className="line">
            <Icon name="help_center" /> Not assigned
          </h3>
          <div className={className}>{none.map((i) => render(i, []))}</div>
        </section>
      )}
    </>
  );
}
