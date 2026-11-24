import { useEffect, useState } from 'react';
import { api } from './api';
import { roomColors, roomStyle } from './roomStyle';

// "Related" lists and delete warnings, read from the hub's dependency index (0013).

export interface Link {
  role: 'trigger' | 'condition' | 'target' | 'member';
  via?: string;
}
interface Item {
  name: string;
  links: Link[];
}
export interface RelatedData {
  devices: Array<Item & { ieee: string }>;
  groups: Array<Item & { id: number }>;
  actions: Array<Item & { id: number; draft: boolean }>;
  rules: Array<Item & { id: number; enabled: boolean; draft: boolean }>;
}

const ROLE: Record<Link['role'], string> = { trigger: 'starts it', condition: 'condition', target: 'switched', member: 'member' };
const ROLE_FOR_RULE: Record<Link['role'], string> = { trigger: 'trigger', condition: 'condition', target: 'target', member: 'member' };

/** Moves to a page, optionally opening one item on it (#page/id). */
export function go(page: string, id?: string | number) {
  window.location.hash = id === undefined ? page : `${page}/${encodeURIComponent(String(id))}`;
}

/** The item id in the address (#page/id), kept in step with the browser's back and forward buttons. */
export function useHashId(): [string | null, (id: string | number | null) => void] {
  const read = () => {
    const [, id] = window.location.hash.slice(1).split('/');
    return id ? decodeURIComponent(id) : null;
  };
  const [id, setId] = useState<string | null>(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const set = (next: string | number | null) => {
    const page = window.location.hash.slice(1).split('/')[0] || 'devices';
    go(page, next === null ? undefined : next);
  };
  return [id, set];
}

function Links({ links, forRule }: { links: Link[]; forRule?: boolean }) {
  return (
    <>
      {links.map((l, i) => (
        <span key={i} className="small muted">
          {' '}
          <span className="badge rounded-pill text-bg-light border">{(forRule ? ROLE_FOR_RULE : ROLE)[l.role]}</span>
          {l.via && <> via {l.via}</>}
        </span>
      ))}
    </>
  );
}

export function Related({ kind, id, refresh }: { kind: 'device' | 'group' | 'action' | 'rule'; id: string | number; refresh?: unknown }) {
  const [data, setData] = useState<RelatedData | null>(null);
  useEffect(() => {
    api<RelatedData>('GET', `/api/related/${kind}/${encodeURIComponent(String(id))}`).then(setData, () => setData(null));
  }, [kind, id, refresh]);
  if (!data) return null;
  const empty = !data.devices.length && !data.groups.length && !data.actions.length && !data.rules.length;
  return (
    <div className="card card-body mb-3 related">
      <h3>Related</h3>
      {empty && <p className="muted small">Nothing uses this yet, and it uses nothing else.</p>}
      {data.devices.length > 0 && (
        <>
          <h4>Devices</h4>
          <ul>
            {data.devices.map((d) => (
              <li key={d.ieee}>
                <ItemLink kind="device" id={d.ieee}>
                  {d.name}
                </ItemLink>
                <Links links={d.links} forRule={kind === 'rule'} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.groups.length > 0 && (
        <>
          <h4>Light groups</h4>
          <ul>
            {data.groups.map((g) => (
              <li key={g.id}>
                <ItemLink kind="group" id={g.id}>
                  {g.name}
                </ItemLink>
                <Links links={g.links} forRule={kind === 'rule'} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.actions.length > 0 && (
        <>
          <h4>Actions</h4>
          <ul>
            {data.actions.map((a) => (
              <li key={a.id}>
                <ItemLink kind="action" id={a.id}>
                  {a.name}
                </ItemLink>
                {a.draft && <span className="badge rounded-pill text-bg-warning">draft</span>}
                <Links links={a.links} forRule={kind === 'rule'} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.rules.length > 0 && (
        <>
          <h4>Automations</h4>
          <ul>
            {data.rules.map((r) => (
              <li key={r.id}>
                <ItemLink kind="rule" id={r.id}>
                  {r.name}
                </ItemLink>
                {r.draft ? <span className="badge rounded-pill text-bg-warning">draft</span> : !r.enabled && <span className="badge rounded-pill text-bg-light border">disabled</span>}
                <Links links={r.links} forRule />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Asks before deleting something others use, naming them. */
export async function confirmDelete(kind: 'device' | 'group' | 'action', id: string | number, name: string, extra = ''): Promise<boolean> {
  let users: RelatedData | null = null;
  try {
    users = await api<RelatedData>('GET', `/api/used-by/${kind}/${encodeURIComponent(String(id))}`);
  } catch {
    users = null;
  }
  const lines = [
    ...(users?.groups ?? []).map((g) => `• light group "${g.name}"`),
    ...(users?.actions ?? []).map((a) => `• action "${a.name}"${a.draft ? ' (draft)' : ''}`),
    ...(users?.rules ?? []).map((r) => `• automation "${r.name}"${r.draft ? ' (draft)' : r.enabled ? '' : ' (disabled)'}`),
  ];
  const used = lines.length
    ? `\n\nThese use it and will stop working or be flagged:\n${lines.join('\n')}`
    : '\n\nNothing else uses it.';
  return confirm(`Delete "${name}"?${extra}${used}`);
}

/** A link to an item's own page. Wherever a device, action, automation, light group or room is named, use this. */
export function ItemLink({ kind, id, children }: { kind: 'device' | 'action' | 'rule' | 'group' | 'room'; id: string | number; children: React.ReactNode }) {
  const page = { device: 'devices', action: 'actions', rule: 'rules', group: 'groups', room: 'rooms' }[kind];
  return (
    <a className="item-link" href={`#${page}/${encodeURIComponent(String(id))}`}>
      {children}
    </a>
  );
}

/** For a device in more than one room: all its rooms as linked chips, main room first and marked. Nothing otherwise. */
export function RoomChips({ roomId, alsoRooms, rooms }: { roomId?: number | null; alsoRooms?: number[]; rooms: Array<{ id: number; name: string; color: string | null }> }) {
  const extra = alsoRooms ?? [];
  if (extra.length === 0) return null;
  const colors = roomColors(rooms);
  const name = (id: number) => rooms.find((r) => r.id === id)?.name ?? `room ${id}`;
  const list = [...(roomId != null ? [{ id: roomId, main: true }] : []), ...extra.map((id) => ({ id, main: false }))];
  return (
    <span className="room-chips">
      {list.map((r) => (
        <ItemLink key={r.id} kind="room" id={r.id}>
          <span className={`badge rounded-pill room-chip${r.main ? ' main' : ''}`} style={roomStyle(colors.get(r.id))} title={r.main ? 'Main room' : 'Also shown here'}>
            {name(r.id)}
            {r.main && ' · main'}
          </span>
        </ItemLink>
      ))}
    </span>
  );
}
