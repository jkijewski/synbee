import { useEffect, useState } from 'react';
import { api, ApiError, onGateway, type DeviceRow, type GatewaySummary, type Room } from './api';
import { RoomSelect } from './devices/RoomPickers';
import { ItemLink } from './Related';
import { Icon } from './Icons';

interface Joined {
  ieee: string;
  name: string;
  imported: boolean;
  at: string;
  interview: 'started' | 'successful' | 'failed' | 'unknown';
  supported: boolean | null;
  model: string | null;
}
type PairingState = { open: boolean; secondsLeft: number; until: string | null; through?: string | null; joined: Joined[] };
type Router = { ieee: string; name: string; network: number; online: boolean | null };

const WAITS = [2, 5, 10, 20, 30];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Pairing() {
  const [state, setState] = useState<PairingState | null>(null);
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState('');
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [roomOf, setRoomOf] = useState<Record<string, number | null>>({});
  const [rooms, setRooms] = useState<Room[]>([]);
  // Which gateway new devices join (0023): only one network is open at a time.
  const [gateways, setGateways] = useState<GatewaySummary[]>([]);
  const [routers, setRouters] = useState<Router[]>([]);
  // Where new devices join: a whole gateway ("net:1", the first by default) or one device near them ("dev:<ieee>").
  const [where, setWhere] = useState('net:1');
  const through = where.startsWith('dev:') ? where.slice(4) : null;
  const network = through ? (routers.find((r) => r.ieee === through)?.network ?? 1) : Number(where.slice(4));
  useEffect(() => {
    void api<GatewaySummary[]>('GET', '/api/gateways').then(setGateways, () => undefined);
    void api<Router[]>('GET', '/api/pairing/routers').then(setRouters, () => undefined);
  }, []);

  useEffect(() => {
    const load = () => {
      void api<DeviceRow[]>('GET', '/api/devices').then((rows) => {
        setIcons(Object.fromEntries(rows.map((d) => [d.ieee, d.icon ?? 'question_mark'])));
        setRoomOf(Object.fromEntries(rows.map((d) => [d.ieee, d.roomId ?? null])));
      }, () => undefined);
      void api<Room[]>('GET', '/api/rooms').then(setRooms, () => undefined);
      return api<PairingState>('GET', onGateway('/api/pairing', network)).then(setState, (e: ApiError) => setError(e.message));
    };
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [network]);

  const send = async (body: object) => {
    setError('');
    try {
      setState(await api<PairingState>('POST', onGateway('/api/pairing', network), { ...body, ...(through ? { through } : {}) }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <div className="card card-body mb-3">
      <h2>Add devices</h2>
      <p className="muted">
        Start waiting, then send the device looking for a network: remove it in the Tuya app with "Disconnect and wipe data", or reset it. Imported devices
        get their old name and room as they join. SynBee keeps joining open for the whole wait.
      </p>
      <label className="line mb-1" style={{ flexWrap: 'wrap' }}>
        Join through
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={where} disabled={state?.open} onChange={(e) => setWhere(e.target.value)}>
          {gateways.map((g) => (
            <optgroup key={g.id} label={g.name}>
              <option value={`net:${g.id}`}>
                {g.name}: any of its devices{g.connected ? '' : ' (not connected)'}
              </option>
              {routers
                .filter((r) => r.network === g.id)
                .map((r) => (
                  <option key={r.ieee} value={`dev:${r.ieee}`} disabled={r.online === false}>
                    {r.name}
                    {r.online === false ? ' (offline)' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="muted small">
        Choose a mains-powered device (a light, plug or wall switch) close to where the new device will be: only it lets the new device in, so the new device joins its gateway
        and starts with a strong link. Battery devices can't let others in, so they aren't listed.
      </p>
      {state?.open ? (
        <div className="line">
          <strong>
            Waiting for devices: {clock(state.secondsLeft)} left
            {state.through ? ` · through ${routers.find((r) => r.ieee === state.through)?.name ?? state.through}` : ''}
          </strong>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => void send({ seconds: 0 })}>Stop waiting</button>
        </div>
      ) : (
        <div className="line">
          <label className="line">
            Wait up to
            <select className="form-select form-select-sm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {WAITS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => void send({ minutes })}>
            Start waiting
          </button>
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}
      {state && state.joined.length > 0 && (
        <>
          <h3>Joined {state.open ? 'so far' : 'during the last wait'}</h3>
          <div className="table-wrap">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Room</th>
                  <th>Joined</th>
                  <th>Setup</th>
                </tr>
              </thead>
              <tbody>
                {state.joined.map((j) => (
                  <tr key={j.ieee}>
                    <td>
                      <span className="device-icon">
                        <Icon name={icons[j.ieee] ?? 'question_mark'} />
                      </span>
                      <strong>
                        <ItemLink kind="device" id={j.ieee}>
                          {j.name}
                        </ItemLink>
                      </strong>
                      <div className="muted small">
                        {j.ieee}
                        {j.imported ? ' · name from the import' : ' · new: name it under Devices'}
                      </div>
                    </td>
                    <td>
                      <RoomSelect
                        rooms={rooms}
                        value={roomOf[j.ieee] ?? null}
                        onChange={(room) =>
                          void api('PUT', `/api/devices/${j.ieee}/rooms`, { room }).then(
                            () => setRoomOf({ ...roomOf, [j.ieee]: room }),
                            (e: ApiError) => setError(e.message),
                          )
                        }
                      />
                    </td>
                    <td>{new Date(j.at).toLocaleTimeString()}</td>
                    <td>
                      {j.interview === 'successful' ? (
                        j.supported ? (
                          <span className="text-success">ready{j.model ? ` (${j.model})` : ''}</span>
                        ) : (
                          <span className="text-danger">joined but not recognised{j.model ? ` (${j.model})` : ''}</span>
                        )
                      ) : j.interview === 'failed' ? (
                        <span className="text-danger">setup failed: wake it or reset it and try again</span>
                      ) : (
                        <span className="muted">setting up… keep battery devices awake by pressing a button</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
