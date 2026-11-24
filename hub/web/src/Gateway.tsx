import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, onGateway, type GatewaySummary } from './api';
import { useHashId } from './Related';
import { BackupPanel, ReplacePanel } from './Status';
import { ItemLink } from './Related';
import { Icon } from './Icons';

// The Gateway page (0007): the Zigbee coordinator in one place.

interface GatewayState {
  address: string;
  webPage: string | null;
  connected: boolean;
  zigbee2mqtt: { bundled: string | null; running: string | null };
  coordinator: { ieee: string | null; type: string | null; firmware: string | null } | null;
  network: { channel: number | null; panId: number | null; extendedPanId: string | null } | null;
  adapterInUse: string | null;
  devices: number;
  backup: Parameters<typeof BackupPanel>[0]['status'];
  settings: { adapter: string; rtscts: boolean; channel: number } | null;
  /** Whether the gateway's own web page asks for a login (0007). */
  web: { web: 'protected' | 'open' | 'unreachable' | 'unknown'; url: string | null; checkedAt: string | null } | null;
}
interface MapData {
  nodes: Array<{ ieee: string; name: string; type: string }>;
  links: Array<{ source: string; target: string; lqi: number | null }>;
}

const ADAPTERS: Array<[string, string]> = [
  ['ember', 'Silicon Labs, EmberZNet (SLZB-06M/MU, SkyConnect)'],
  ['zstack', 'Texas Instruments, Z-Stack (SLZB-06, CC2652)'],
  ['deconz', 'dresden elektronik, deCONZ (ConBee, RaspBee)'],
  ['zigate', 'ZiGate'],
  ['zboss', 'Nordic, ZBOSS'],
];

interface SlzbSecurity {
  device: string;
  build: number | null;
  tested: boolean;
  webLogin: boolean;
  whitelist: { on: boolean; ip: string };
  apPassword: boolean;
  webOffWhileConnected: boolean;
  mqtt: boolean;
  wifiConfigured: boolean;
}
type SlzbView = { loginSaved: boolean; user?: string; security: SlzbSecurity | null; webOff?: boolean };

const State = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={`badge rounded-pill ${ok ? 'text-bg-success' : 'text-bg-warning'}`}>{ok ? yes : no}</span>;

/**
 * "Harden gateway security" (0007). With the gateway's login, SynBee reads its protections and sets them on request
 * (option B), reading each back; the gateway's settings interface is undocumented, so untested firmware needs a yes.
 * Without the login, the same steps are a checklist the owner ticks.
 */
function GatewaySecurity({ network, web, webPage, onChecked }: { network: number; web: GatewayState['web']; webPage: string | null; onChecked: () => void }) {
  const [view, setView] = useState<SlzbView | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('');
  const [apPass, setApPass] = useState('');
  const [untestedOk, setUntestedOk] = useState(false);
  const busyNote = 'Talking to the gateway…';
  // Reloading never clears a message the last action showed: an error stays until the next action.
  const load = useCallback(() => {
    api<SlzbView>('GET', onGateway('/api/gateway/slzb', network)).then(setView, (e: ApiError) => {
      setError(e.message);
      setView((v) => v ?? { loginSaved: true, security: null });
    });
  }, [network]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError('');
    setNote(busyNote);
    try {
      await fn();
      setNote(done ?? '');
      load();
      onChecked();
    } catch (err) {
      setNote('');
      setError((err as ApiError).message);
    }
    setBusy(false);
  };
  const set = (step: string, extra: object, done: string) =>
    run(async () => {
      const r = await api<{ needReboot: boolean; nasIp: string | null }>('POST', onGateway('/api/gateway/slzb/set', network), { step, untestedOk, ...extra });
      if (r.needReboot) setTimeout(load, 15000);
    }, done);
  const sec = view?.security ?? null;
  const left = sec ? [!sec.webLogin, !sec.whitelist.on, !sec.apPassword, sec.mqtt].filter(Boolean).length : null;

  return (
    <div className={`card card-body mb-3${left ? ' border-warning' : ''}`}>
      <h3 className="line mb-1">
        <Icon name="shield_lock" /> Harden gateway security
        {left !== null && <span className={`badge rounded-pill ${left ? 'text-bg-warning' : 'text-bg-success'}`}>{left ? `${left} step${left === 1 ? '' : 's'} left` : 'done'}</span>}
      </h3>
      <p className="small text-body-secondary mb-3">
        Make SynBee the only thing that can control this gateway.
        {webPage && (
          <>
            {' '}
            Its own web page:{' '}
            <a href={webPage} target="_blank" rel="noreferrer">
              open it ↗
            </a>
            .
          </>
        )}
      </p>

      {view && !view.loginSaved && (
        <>
          <p className="mb-2">
            <strong>Let SynBee set these for you.</strong> Enter the gateway's web login (the one you set on its Security page). SynBee checks it, keeps it in the
            package's private folder like the network key, and then reads and sets the protections below. Without it, set them on the gateway's page yourself.
          </p>
          <div className="row g-2 align-items-end mb-3">
            <div className="col-sm-4">
              <label className="form-label small mb-1" htmlFor={`gw-user-${network}`}>Gateway login</label>
              <input id={`gw-user-${network}`} className="form-control form-control-sm" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
            <div className="col-sm-4">
              <label className="form-label small mb-1" htmlFor={`gw-pass-${network}`}>Password</label>
              <input id={`gw-pass-${network}`} className="form-control form-control-sm" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="col-auto">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !user || !password}
                onClick={() => void run(() => api('PUT', onGateway('/api/gateway/slzb/login', network), { user: user.trim(), password }).then(() => setPassword('')), 'Login checked and kept on the NAS.')}
              >
                Use this login
              </button>
            </div>
          </div>
          {web && (
            <p className="small mb-0">
              Its web page: <State ok={web.web !== 'open'} yes={web.web === 'protected' ? 'asks for a login' : 'not answering'} no="no password" /> SynBee checks this one by itself.
            </p>
          )}
        </>
      )}

      {view?.loginSaved && !sec && !view.webOff && <p className="text-body-secondary">Reading the gateway's settings…</p>}
      {view?.webOff && (
        <div className="mb-2">
          <p className="mb-2">
            <strong>Its web page is off while SynBee is connected</strong> <State ok yes="on (strictest)" no="" />
          </p>
          <p className="small mb-2">
            As you set it: while SynBee is connected, the gateway hides its settings from everyone, SynBee included, so they can't be read or changed here. The
            other protections stay as they were.
          </p>
          <p className="small mb-1">To change anything, or to switch this off again:</p>
          <ol className="small mb-2">
            <li>In DSM's Package Center, stop SynBee. The gateway's page then works again.</li>
            <li>
              Open {webPage ? (
                <a href={webPage} target="_blank" rel="noreferrer">
                  the gateway's page ↗
                </a>
              ) : (
                "the gateway's page"
              )}{' '}
              and change what you need on its Security page; untick the option that switches the web page off while connected, if you want SynBee to manage it again.
            </li>
            <li>Start SynBee again, then tell SynBee below.</li>
          </ol>
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={busy}
            onClick={() => void run(() => api('PUT', onGateway('/api/gateway/hardening', network), { step: 'webOffWhileConnected', done: false }), 'Reading the gateway again.')}
          >
            I switched it off on the gateway
          </button>
        </div>
      )}

      {sec && (
        <>
          {!sec.tested && (
            <div className="alert alert-warning small py-2">
              SynBee hasn't been tested with this firmware ({sec.device}, build {sec.build ?? 'unknown'}). Its settings interface is undocumented and may differ.
              <div className="form-check mt-1">
                <input className="form-check-input" type="checkbox" id={`gw-untested-${network}`} checked={untestedOk} onChange={(e) => setUntestedOk(e.target.checked)} />
                <label className="form-check-label" htmlFor={`gw-untested-${network}`}>Change settings anyway</label>
              </div>
            </div>
          )}
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2"><strong>Its web page asks for a password</strong><State ok={sec.webLogin} yes="on" no="off" /></div>
            <div className="small text-body-secondary">SynBee is using this login. To change the password, do it on the gateway's page, then enter it here again.</div>
          </div>
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <strong>Only this NAS can talk to the radio</strong>
              <State ok={sec.whitelist.on} yes={`on, allowed ${sec.whitelist.ip}`} no="off" />
              {!sec.whitelist.on ? (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Allow only this NAS to use the gateway's radio socket? SynBee uses the address the gateway sees it connect from. If SynBee can't reach the radio two minutes later, it switches this off again by itself."))
                      void set('whitelist', {}, 'Whitelist on. The gateway may restart; the Zigbee connection comes back in a moment.');
                  }}
                >
                  Allow only this NAS
                </button>
              ) : (
                <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => void set('whitelist', { on: false }, 'Whitelist off.')}>
                  Switch off
                </button>
              )}
            </div>
            <div className="small text-body-secondary">Without it, anything on your network can take over the radio (port 6638) whenever SynBee isn't connected, network key included.</div>
          </div>
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <strong>Its recovery Wi-Fi has a password</strong>
              <State ok={sec.apPassword} yes="on" no="off" />
            </div>
            <div className="small text-body-secondary mb-1">When the gateway loses its network it opens its own Wi-Fi for setup; without a password, anyone nearby can join it. Keep this password somewhere safe.</div>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <input className="form-control form-control-sm" style={{ maxWidth: '14rem' }} type="password" autoComplete="new-password" placeholder="New password (8 or more)" value={apPass} onChange={(e) => setApPass(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={busy || apPass.length < 8} onClick={() => void set('apPassword', { password: apPass }, 'Recovery Wi-Fi password set.').then(() => setApPass(''))}>
                {sec.apPassword ? 'Change' : 'Set'}
              </button>
            </div>
          </div>
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <strong>Its own MQTT and Home Assistant features are off</strong>
              <State ok={!sec.mqtt} yes="off" no="on" />
              {sec.mqtt && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void set('mqttOff', {}, 'Switched off.')}>
                  Switch off
                </button>
              )}
            </div>
            <div className="small text-body-secondary">When on, the gateway connects to another broker that can send it commands. SynBee doesn't use them.</div>
          </div>
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2"><strong>Wi-Fi off (it's on a cable)</strong><State ok={!sec.wifiConfigured} yes="no Wi-Fi set up" no="Wi-Fi set up" /></div>
            <div className="small text-body-secondary">Optional: one way in fewer. Remove its Wi-Fi network on the gateway's Network page if it isn't needed.</div>
          </div>
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <strong>Its web page off while SynBee is connected (strictest)</strong>
              <State ok={sec.webOffWhileConnected} yes="on" no="off" />
              <button
                className="btn btn-outline-secondary btn-sm"
                disabled={busy}
                onClick={() => {
                  if (sec.webOffWhileConnected || window.confirm("Switch the gateway's web page off while SynBee is connected? SynBee then can't read or change these settings either; for firmware updates or changes, stop SynBee first (Package Center → Stop)."))
                    void set('webOffWhileConnected', { on: !sec.webOffWhileConnected }, 'Done.');
                }}
              >
                {sec.webOffWhileConnected ? 'Switch off' : 'Switch on'}
              </button>
            </div>
            <div className="small text-body-secondary">Optional. Most secure, but the page and these buttons then work only while SynBee is stopped.</div>
          </div>
          <p className="small text-body-secondary mb-0">
            {sec.device}, firmware build {sec.build ?? 'unknown'}. SynBee logs in as {view?.user}.{' '}
            <button className="btn btn-link btn-sm p-0 align-baseline" onClick={() => void run(() => api('DELETE', onGateway('/api/gateway/slzb/login', network)), 'Login forgotten.')}>
              Forget the login
            </button>
          </p>
        </>
      )}
      {note && <p className={`mb-0 mt-2 ${note === busyNote ? 'text-body-secondary' : 'text-success'}`}>{note}</p>}
      {error && <p className="text-danger mb-0 mt-2">{error}</p>}
    </div>
  );
}

/** The gateways (0023): each its own Zigbee network. Picking one shows its page below; #gateway/<id> opens it. */
function GatewayList({ gateways, selected, onSelect, onChanged }: { gateways: GatewaySummary[]; selected: number; onSelect: (id: number) => void; onChanged: () => void }) {
  const [error, setError] = useState('');
  const add = async () => {
    const name = window.prompt('Name of the new gateway, e.g. Garaż');
    if (!name?.trim()) return;
    setError('');
    try {
      const n = await api<{ id: number }>('POST', '/api/gateways', { name });
      onChanged();
      onSelect(n.id);
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  return (
    <div className="card card-body mb-3">
      <div className="line" style={{ flexWrap: 'wrap' }}>
        {gateways.map((g) => (
          <button key={g.id} className={`btn btn-sm ${g.id === selected ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => onSelect(g.id)}>
            <span className={`badge rounded-pill me-1 ${g.connected ? 'text-bg-success' : 'text-bg-warning'}`}>&nbsp;</span>
            {g.name} <span className="small">· {g.devices} device{g.devices === 1 ? '' : 's'}</span>
          </button>
        ))}
        <button className="btn btn-outline-secondary btn-sm" onClick={() => void add()}>
          Add a gateway
        </button>
      </div>
      {gateways.length > 1 && (
        <p className="muted small mb-0 mt-2">Each gateway is its own Zigbee network, on its own channel. Rules, actions, rooms and the app work across all of them.</p>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

/** The first address of a gateway that has none yet. */
function FirstAddress({ network, onSaved }: { network: number; onSaved: () => void }) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<Array<{ name: string; address: string }> | null>(null);
  const save = async () => {
    setError('');
    try {
      await api('POST', onGateway('/api/coordinator/address', network), { address });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  return (
    <div className="step">
      <p>
        Connect the coordinator to your network, then enter its address as <code>host:port</code>. Its Zigbee network is created on the channel in its
        settings below (20 for a second gateway, away from the first).
      </p>
      <div className="line">
        <input className="form-control form-control-sm" style={{ maxWidth: '16rem' }} placeholder="192.168.1.40:6638" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!address.trim()} onClick={() => void save()}>
          Use this address
        </button>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => void api<{ found: Array<{ name: string; address: string }> }>('GET', '/api/gateway/discover').then((r) => setFound(r.found))}>
          Find on the network
        </button>
      </div>
      {found && (found.length ? found.map((f) => <button key={f.address} className="btn btn-link btn-sm" onClick={() => setAddress(f.address)}>{f.name} ({f.address})</button>) : <p className="muted small">None found.</p>)}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

export function GatewayPage() {
  const [hashId, setHashId] = useHashId();
  const network = hashId && /^\d$/.test(hashId) ? Number(hashId) : 1;
  const [gateways, setGateways] = useState<GatewaySummary[]>([]);
  const [state, setState] = useState<GatewayState | null>(null);
  const [coordinator, setCoordinator] = useState<Parameters<typeof ReplacePanel>[0]['state']>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const load = useCallback(() => {
    api<GatewaySummary[]>('GET', '/api/gateways').then(setGateways, () => undefined);
    api<GatewayState>('GET', onGateway('/api/gateway', network)).then(setState, (e: ApiError) => setMessage({ text: e.message, error: true }));
    api<NonNullable<Parameters<typeof ReplacePanel>[0]['state']>>('GET', onGateway('/api/coordinator', network)).then(setCoordinator, () => setCoordinator(null));
  }, [network]);
  useEffect(load, [load]);
  const current = gateways.find((g) => g.id === network);
  const rename = async () => {
    const name = window.prompt('New name', current?.name ?? '');
    if (!name?.trim()) return;
    await api('PUT', `/api/gateways/${network}`, { name }).catch((e: ApiError) => setMessage({ text: e.message, error: true }));
    load();
  };
  const remove = async () => {
    if (!window.confirm(`Remove "${current?.name}" from SynBee? Its Zigbee2MQTT stops; its devices stop working until they are paired with another gateway. Its data and backup stay on the NAS.`)) return;
    await api('DELETE', `/api/gateways/${network}`).catch((e: ApiError) => setMessage({ text: e.message, error: true }));
    setHashId(null);
  };

  const restart = async () => {
    setMessage(null);
    try {
      const r = await api<{ restarted: boolean }>('POST', onGateway('/api/gateway/restart', network));
      setMessage(r.restarted ? { text: 'The Zigbee connection is restarting; it takes about half a minute.', error: false } : { text: 'Restart the package to reconnect.', error: true });
      setTimeout(load, 20000);
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const s = state;
  return (
    <>
      <GatewayList gateways={gateways} selected={network} onSelect={(id) => setHashId(id === 1 ? null : id)} onChanged={load} />
      <div className="card card-body mb-3">
        <h2 className="line">
          <Icon name="router" size="1.8rem" /> {current?.name ?? 'Gateway'}
          {s && <span className={`badge rounded-pill ${s.connected ? 'text-bg-success' : 'text-bg-warning'}`}>{s.connected ? 'connected' : 'not connected'}</span>}
        </h2>
        <p className="muted small line">
          The Zigbee coordinator that talks to its devices. A network has exactly one.
          <button className="btn btn-link btn-sm" onClick={() => void rename()}>Rename</button>
          {network !== 1 && (
            <button className="btn btn-link btn-sm text-danger" onClick={() => void remove()}>
              Remove
            </button>
          )}
        </p>
        {s && !s.address && <FirstAddress network={network} onSaved={load} />}
        {s && (
          <table className="table table-sm align-middle">
            <tbody>
              <tr>
                <th>Address</th>
                <td>{s.address ? <code>tcp://{s.address}</code> : <span className="muted">not set</span>}</td>
              </tr>
              <tr>
                <th>Adapter</th>
                <td>
                  {s.adapterInUse ?? s.settings?.adapter ?? '?'}
                  {s.coordinator?.type && ` · ${s.coordinator.type}`}
                </td>
              </tr>
              <tr>
                <th>Firmware</th>
                <td>{s.coordinator?.firmware ?? <span className="muted">unknown</span>}</td>
              </tr>
              <tr>
                <th>Coordinator address (IEEE)</th>
                <td>{s.coordinator?.ieee ?? <span className="muted">unknown</span>}</td>
              </tr>
              <tr>
                <th>Zigbee2MQTT</th>
                <td>
                  {s.zigbee2mqtt.bundled ?? '?'} bundled{s.zigbee2mqtt.running ? `, ${s.zigbee2mqtt.running} running` : ', not running'}
                </td>
              </tr>
              <tr>
                <th>Network</th>
                <td>
                  {s.network ? (
                    <>
                      channel {s.network.channel ?? '?'} · PAN ID {s.network.panId ?? '?'} · extended PAN ID {s.network.extendedPanId ?? '?'}
                    </>
                  ) : (
                    <span className="muted">unknown</span>
                  )}
                  <div className="muted small">The network key is never shown.</div>
                </td>
              </tr>
              <tr>
                <th>Devices</th>
                <td>{s.devices}</td>
              </tr>
              <tr>
                <th>Last backup</th>
                <td>{s.backup?.writtenAt ? new Date(s.backup.writtenAt).toLocaleString() : <span className="muted">none yet</span>}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div className="line" style={{ marginTop: '0.75rem' }}>
          <a href="#pairing">
            <button className="btn btn-primary btn-sm">Add devices</button>
          </a>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => void restart()}>Restart Zigbee connection</button>
          {s?.webPage && (
            <a href={s.webPage} target="_blank" rel="noreferrer">
              <button className="btn btn-outline-secondary btn-sm" title="Firmware updates are done there; SynBee never flashes firmware">Gateway's own web page (firmware) ↗</button>
            </a>
          )}
          <button className="btn btn-outline-secondary btn-sm" onClick={() => document.getElementById('gateway-backup')?.scrollIntoView({ behavior: 'smooth' })}>Backup</button>
        </div>
        {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      </div>
      {s && <GatewaySecurity key={`security-${network}`} network={network} web={s.web} webPage={s.webPage} onChecked={load} />}
      <NetworkMap key={`map-${network}`} network={network} />
      {s?.settings && <SettingsPanel key={`settings-${network}`} settings={s.settings} onSaved={load} network={network} />}
      <div id="gateway-backup">
        <BackupPanel key={`backup-${network}`} status={s?.backup ?? null} onChange={load} network={network} />
      </div>
      {s?.address ? <ReplacePanel key={`replace-${network}`} state={coordinator} onChange={load} network={network} /> : null}
    </>
  );
}

function SettingsPanel({ settings, onSaved, network }: { settings: NonNullable<GatewayState['settings']>; onSaved: () => void; network: number }) {
  const [adapter, setAdapter] = useState(settings.adapter);
  const [rtscts, setRtscts] = useState(settings.rtscts);
  const [channel, setChannel] = useState(settings.channel);
  const [confirmChannel, setConfirmChannel] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const save = async () => {
    setMessage(null);
    try {
      await api('PUT', onGateway('/api/gateway/settings', network), { adapter, rtscts, channel, confirmChannelChange: confirmChannel });
      setMessage({ text: 'Saved. The Zigbee connection restarts with the new settings.', error: false });
      setConfirmChannel(false);
      onSaved();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };
  const changed = adapter !== settings.adapter || rtscts !== settings.rtscts || channel !== settings.channel;
  return (
    <div className="card card-body mb-3">
      <h3>Settings</h3>
      <p className="muted small">The address is changed with "Replace the gateway" below.</p>
      <label>
        Adapter type
        <select className="form-select form-select-sm" value={adapter} onChange={(e) => setAdapter(e.target.value)}>
          {ADAPTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="line">
        <input className="form-check-input" type="checkbox" checked={rtscts} onChange={(e) => setRtscts(e.target.checked)} />
        Hardware flow control (RTS/CTS). Off for network gateways such as the SLZB-06MU.
      </label>
      <details>
        <summary>Advanced</summary>
        <label>
          Zigbee channel (11 to 26)
          <input className="form-control form-control-sm" type="number" min={11} max={26} value={channel} onChange={(e) => setChannel(Number(e.target.value))} style={{ width: '6rem' }} />
        </label>
        {channel !== settings.channel && (
          <>
            <p className="text-danger small">
              Changing the channel moves the whole network. Many devices don't follow and have to be paired again, one by one. Only do this on a new
              network, or when Wi-Fi interference makes it necessary.
            </p>
            <label className="line">
              <input className="form-check-input" type="checkbox" checked={confirmChannel} onChange={(e) => setConfirmChannel(e.target.checked)} />I understand devices may need pairing
              again
            </label>
          </>
        )}
      </details>
      <button className="btn btn-primary btn-sm" disabled={!changed || (channel !== settings.channel && !confirmChannel)} onClick={() => void save()}>
        Save and reconnect
      </button>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
    </div>
  );
}

function NetworkMap({ network }: { network: number }) {
  const [map, setMap] = useState<MapData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setMap(await api<MapData>('POST', onGateway('/api/gateway/networkmap', network)));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  // A simple radial layout: the coordinator in the middle, routers around it, end devices on the outside.
  const W = 640;
  const H = 420;
  const pos = new Map<string, { x: number; y: number }>();
  if (map) {
    const ring = (list: MapData['nodes'], r: number) =>
      list.forEach((n, i) => {
        const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
        pos.set(n.ieee, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r });
      });
    ring(map.nodes.filter((n) => n.type === 'Coordinator'), 0);
    ring(map.nodes.filter((n) => n.type === 'Router'), 110);
    ring(map.nodes.filter((n) => n.type !== 'Router' && n.type !== 'Coordinator'), 180);
  }
  const colour = (lqi: number | null) => (lqi === null ? 'var(--muted)' : lqi >= 150 ? 'var(--ok)' : lqi >= 80 ? '#b54708' : 'var(--danger)');
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h3 style={{ marginRight: 'auto' }}>Network map</h3>
        <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Scanning… this can take a minute or two' : map ? 'Refresh map' : 'Draw the map'}
        </button>
      </div>
      <p className="muted small">The gateway asks every router which devices it hears. It adds radio traffic for a while, so it isn't drawn automatically.</p>
      {error && <p className="text-danger">{error}</p>}
      {map && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="network-map" role="img" aria-label="Zigbee network map">
            {map.links.map((l, i) => {
              const a = pos.get(l.source);
              const b = pos.get(l.target);
              if (!a || !b) return null;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colour(l.lqi)} strokeWidth={2} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} className="lqi">
                    {l.lqi ?? '?'}
                  </text>
                </g>
              );
            })}
            {map.nodes.map((n) => {
              const p = pos.get(n.ieee);
              if (!p) return null;
              return (
                <g key={n.ieee}>
                  <circle cx={p.x} cy={p.y} r={n.type === 'Coordinator' ? 14 : 9} className={`node ${n.type.toLowerCase()}`} />
                  <text x={p.x} y={p.y + 24} textAnchor="middle" className="node-name">
                    {n.type === 'Coordinator' ? 'Gateway' : n.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="small muted">Link quality (LQI): green is good, orange fair, red weak. Routers (mains devices) are on the inner ring.</p>
          <ul className="small">
            {map.nodes
              .filter((n) => n.type !== 'Coordinator')
              .map((n) => (
                <li key={n.ieee}>
                  <ItemLink kind="device" id={n.ieee}>
                    {n.name}
                  </ItemLink>{' '}
                  <span className="muted">{n.type}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
