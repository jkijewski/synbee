import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, ApiError, shortFingerprint, type Action, type Member, type MembersView, type PairingCode, type Room } from './api';
import { Icon } from './Icons';
import { useRooms, type Membership } from './RoomSections';
import { roomColors, roomStyle } from './roomStyle';
import { useApi } from './useApi';

// App users (0020): the people who use the mobile app, what each may see and run, and their paired phones.

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

export function Members() {
  const view = useApi<MembersView>('/api/members', { refreshMs: 10_000 });
  const actions = useApi<Action[]>('/api/actions');
  const { rooms, membership } = useRooms();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      view.reload();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  if (!view.data) return <p className="card card-body mb-3 muted">{view.error || 'Loading…'}</p>;
  const { members, app } = view.data;
  return (
    <>
      <div className="card card-body mb-3">
        <h2>App users</h2>
        <p className="muted">
          People who use the SynBee app on their phones. Each can see and run everything until you take something away. The app works on the home network
          {app ? `, on port ${app.port}` : ''}, and away from home when you allow it below. Nobody can change settings from it.
        </p>
        {!app && <p className="text-warning">The app listener isn't running on this hub, so phones can't be paired.</p>}
        <form
          className="line"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('POST', '/api/members', { name });
              setName('');
            });
          }}
        >
          <input className="form-control form-control-sm" style={{ maxWidth: '16rem' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Anna" maxLength={40} />
          <button className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Add user
          </button>
        </form>
        {error && <p className="text-danger">{error}</p>}
        {members.length === 0 && <p className="muted">No app users yet.</p>}
      </div>
      {app && <AwayFromHome appPort={app.port} />}
      {members.map((m) => (
        <MemberCard key={m.id} member={m} actions={actions.data ?? []} rooms={rooms} membership={membership} canPair={Boolean(app)} onChange={view.reload} />
      ))}
    </>
  );
}

interface AppAccess {
  outside: boolean;
  address: string;
  port: number | null;
  appPort: number | null;
}

/**
 * The app away from home (0021), like Synology Photos: an address (a DDNS name or public IP) and a port forwarded on
 * the router to this NAS. Phones learn the address from the hub, and can be paired away from home too.
 */
function AwayFromHome({ appPort }: { appPort: number }) {
  const [access, setAccess] = useState<AppAccess | null>(null);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    api<AppAccess>('GET', '/api/app-access').then((a) => {
      setAccess(a);
      setAddress(a.address);
      setPort(a.port ? String(a.port) : '');
    }, (e: ApiError) => setError(e.message));
  }, []);
  const save = async (outside: boolean) => {
    setError('');
    setNote('');
    try {
      const a = await api<AppAccess>('PUT', '/api/app-access', { outside, address, port: port ? Number(port) : null });
      setAccess(a);
      setNote(outside ? 'On. Phones learn the address the next time they connect at home.' : 'Off: the app works only at home.');
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  if (!access) return null;
  const outsidePort = port ? Number(port) : appPort;
  return (
    <div className="card card-body mb-3">
      <h3 className="line mb-1">
        <Icon name="public" /> Using the app away from home
        <span className={`badge rounded-pill ${access.outside ? 'text-bg-success' : 'text-bg-light border'}`}>{access.outside ? 'on' : 'off'}</span>
      </h3>
      <p className="small text-body-secondary mb-3">
        Like Synology Photos: phones reach SynBee at an address and port of your home's internet connection, which the router forwards to this NAS. The app uses the home
        address on Wi-Fi and this one elsewhere, over TLS with SynBee's own key, which it checks. A phone can be paired at home or away; one paired away is allowed away from home at once. With this on, the app's requests travel over the internet to
        your NAS, encrypted and accepted only with a paired phone's token; nothing else of SynBee's leaves your network, and the web interface stays home-only.
      </p>
      <div className="row g-2 align-items-end mb-3">
        <div className="col-sm-6 col-lg-5">
          <label className="form-label small mb-1" htmlFor="away-address">
            Outside address
          </label>
          <input id="away-address" className="form-control form-control-sm" placeholder="e.g. myhome.synology.me" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="col-6 col-sm-3 col-lg-2">
          <label className="form-label small mb-1" htmlFor="away-port">
            Port
          </label>
          <input id="away-port" className="form-control form-control-sm" inputMode="numeric" placeholder={String(appPort)} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="col-auto">
          {access.outside ? (
            <>
              <button className="btn btn-primary btn-sm me-2" onClick={() => void save(true)}>
                Save
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => void save(false)}>
                Switch off
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={!address.trim()} onClick={() => void save(true)}>
              Switch on
            </button>
          )}
        </div>
      </div>
      <details className="small">
        <summary>How to set it up</summary>
        <ol className="mt-2 mb-0">
          <li>
            <strong>An address for your home:</strong> a fixed public IP, or a DDNS name that follows a changing one. DSM has one built in: Control Panel → External Access →
            DDNS (e.g. <code>myhome.synology.me</code>).
          </li>
          <li>
            <strong>On the router:</strong> forward TCP port <strong>{outsidePort}</strong> to this NAS, port <strong>{appPort}</strong>. Forward only this one: never the
            web interface's port, and never 80 or 443.
          </li>
          <li>
            <strong>In DSM's firewall</strong>, if it's on: allow port {appPort} ("SynBee (phone app)") from everywhere.
          </li>
          <li>Enter the address and port here and switch on. Then open the app once at home; it learns the address and uses it away from home.</li>
        </ol>
      </details>
      {note && <p className="text-success mb-0 mt-2">{note}</p>}
      {error && <p className="text-danger mb-0 mt-2">{error}</p>}
    </div>
  );
}

function ActionBox({ action, allowed, dimmed, onChange }: { action: Action; allowed: boolean; dimmed: boolean; onChange: (allowed: boolean) => void }) {
  return (
    <label className={`line${dimmed ? ' muted' : ''}`}>
      <input className="form-check-input" type="checkbox" checked={allowed} onChange={(e) => onChange(e.target.checked)} />
      <Icon name={action.icon} /> {action.name}
    </label>
  );
}

function MemberCard({ member, actions, rooms, membership, canPair, onChange }: { member: Member; actions: Action[]; rooms: Room[]; membership: Membership | null; canPair: boolean; onChange: () => void }) {
  const colors = roomColors(rooms);
  const shown = actions.filter((a) => !a.draft);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState<(PairingCode & { image: string }) | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onChange();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  const permissions = (change: Partial<Pick<Member, 'revokedActions' | 'revokedRooms' | 'devicesWithoutRoom'>>) =>
    run(() =>
      api('PUT', `/api/members/${member.id}/permissions`, {
        revokedActions: member.revokedActions,
        revokedRooms: member.revokedRooms,
        devicesWithoutRoom: member.devicesWithoutRoom,
        ...change,
      }),
    );
  const toggle = (list: number[], id: number, allowed: boolean) => (allowed ? list.filter((x) => x !== id) : [...list, id]);
  const pair = () =>
    run(async () => {
      const p = await api<PairingCode>('POST', `/api/members/${member.id}/pairing-code`);
      setPairing({ ...p, image: await QRCode.toDataURL(p.qr, { margin: 1, width: 260 }) });
    });

  return (
    <div className="card card-body mb-3">
      <div className="line">
        {editing ? (
          <form
            className="line"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('PUT', `/api/members/${member.id}`, { name });
                setEditing(false);
              });
            }}
          >
            <input className="form-control form-control-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <button className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => (setEditing(false), setName(member.name))}>
              Cancel
            </button>
          </form>
        ) : (
          <h3 style={{ marginRight: 'auto' }}>{member.name}</h3>
        )}
        {!editing && (
          <button className="btn btn-outline-secondary btn-sm member-btn" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        <button
          className="btn btn-outline-danger btn-sm member-btn"
          onClick={() => {
            if (window.confirm(`Remove ${member.name}? Their ${member.phones.length} paired phone(s) stop working at once.`)) void run(() => api('DELETE', `/api/members/${member.id}`));
          }}
        >
          Remove
        </button>
        {member.phones.map((p) => (
          <button
            key={p.id}
            className="btn btn-outline-secondary btn-sm member-btn"
            title={`Revoke ${p.name}: it stops working and must be paired again`}
            onClick={() => {
              if (window.confirm(`Revoke ${p.name}? It must be paired again to work.`)) void run(() => api('DELETE', `/api/members/${member.id}/phones/${p.id}`));
            }}
          >
            {member.phones.length === 1 ? 'Revoke' : `Revoke ${p.name}`}
          </button>
        ))}
      </div>
      {error && <p className="text-danger">{error}</p>}

      <h4 className="h6 mt-2">Phones</h4>
      {member.phones.length === 0 && <p className="muted">No paired phones.</p>}
      {member.phones.map((p) => (
        <div className="line phone-row" key={p.id}>
          <div style={{ marginRight: 'auto' }}>
            <strong>{p.name}</strong>{' '}
            <span className="muted small">
              paired {when(p.pairedAt)} · last used {when(p.lastUsedAt)}
            </span>
          </div>
          <div className="form-check form-switch mb-0 phone-switch" title="Away from home works only while 'Using the app away from home' is on, above">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id={`outside-${p.id}`}
              checked={p.outside}
              onChange={(e) => void run(() => api('PUT', `/api/members/${member.id}/phones/${p.id}`, { outside: e.target.checked }))}
            />
            <label className="form-check-label small" htmlFor={`outside-${p.id}`}>
              Away from home
            </label>
          </div>
        </div>
      ))}
      <div className="line mt-1">
        <button className="btn btn-primary btn-sm" disabled={!canPair} onClick={() => void pair()}>
          Pair a phone
        </button>
        {pairing && (
          <button className="btn btn-outline-secondary btn-sm" onClick={() => (setPairing(null), onChange())}>
            Done
          </button>
        )}
      </div>
      {pairing && (
        <div className="line mt-2" style={{ alignItems: 'flex-start' }}>
          <img src={pairing.image} alt={`Pairing QR code for ${member.name}`} width={260} height={260} />
          <div>
            <p>Scan this in the SynBee app on {member.name}'s phone, at home or away.</p>
            <p>
              Or type the code <strong>{pairing.code}</strong> and the address <strong>{pairing.addresses[0]}</strong>
              {pairing.outside?.[0] && (
                <>
                  {' '}
                  (away from home: <strong>{pairing.outside[0]}</strong>)
                </>
              )}
              , then check that the app shows the key{' '}
              <code>{shortFingerprint(pairing.fingerprint)}</code>.
            </p>
            <p className="muted">Valid once, until {new Date(pairing.expiresAt).toLocaleTimeString()}.</p>
          </div>
        </div>
      )}

      <details className="mt-2">
        <summary>
          What {member.name} may use{' '}
          <span className="muted small">
            ({member.revokedActions.length || member.revokedRooms.length || !member.devicesWithoutRoom ? 'some things taken away' : 'everything'})
          </span>
        </summary>
        <p className="muted small mt-2">
          A room's box shows or hides the room in the app, with its devices. An action shows in each allowed room of its devices; an action whose rooms are all
          hidden isn't shown.
        </p>
        {rooms.map((room) => {
          const list = shown.filter((a) => (membership?.actions[a.id] ?? []).includes(room.id));
          const roomAllowed = !member.revokedRooms.includes(room.id);
          return (
            <section key={room.id} className="room-section" style={roomStyle(colors.get(room.id))}>
              <h3 className="line">
                <input
                  className="form-check-input"
                  type="checkbox"
                  aria-label={`${room.name} in the app`}
                  checked={roomAllowed}
                  onChange={(e) => void permissions({ revokedRooms: toggle(member.revokedRooms, room.id, e.target.checked) })}
                />
                <Icon name={room.icon} /> {room.name}
              </h3>
              {list.length === 0 && <p className="muted small mb-1">No actions use this room's devices.</p>}
              {list.map((a) => (
                <ActionBox key={a.id} action={a} allowed={!member.revokedActions.includes(a.id)} dimmed={!roomAllowed} onChange={(allowed) => void permissions({ revokedActions: toggle(member.revokedActions, a.id, allowed) })} />
              ))}
            </section>
          );
        })}
        <section className="room-section">
          <h3 className="line">
            <input className="form-check-input" type="checkbox" aria-label="Devices without a room" checked={member.devicesWithoutRoom} onChange={(e) => void permissions({ devicesWithoutRoom: e.target.checked })} />
            <Icon name="help_center" /> Not in a room
          </h3>
          {shown
            .filter((a) => (membership?.actions[a.id] ?? []).length === 0)
            .map((a) => (
              <ActionBox key={a.id} action={a} allowed={!member.revokedActions.includes(a.id)} dimmed={false} onChange={(allowed) => void permissions({ revokedActions: toggle(member.revokedActions, a.id, allowed) })} />
            ))}
        </section>
      </details>
      <label className="line small mt-2 mb-0">
        <input className="form-check-input" type="checkbox" checked={member.mayPauseAlerts ?? false} onChange={(e) => void run(() => api('PUT', `/api/members/${member.id}/pause-alerts`, { allowed: e.target.checked }))} />
        May pause alerts from the app (nothing goes to Synology Chat while paused)
      </label>
    </div>
  );
}
