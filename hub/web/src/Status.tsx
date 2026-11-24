import { HistorySettings } from './history/HistorySettings';
import { LocationSettings } from './LocationSettings';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, onGateway } from './api';
import { useApi } from './useApi';

// Hub status, the coordinator backup (0007) and the guided coordinator replacement.

interface Database {
  version: number;
  latest: number;
  upgrades: Array<{ at: string; fromVersion: number; toVersion: number; snapshot: string | null }>;
  snapshots: Array<{ name: string; fromVersion: number; at: string; bytes: number }>;
  zigbee2mqttSnapshots: string[];
}
interface Status {
  version: string;
  database?: Database;
  zigbee2mqtt: {
    bundled: string | null;
    connected: boolean;
    info: { version: string | null; coordinator: { ieee: string | null; type: string | null; firmware: string | null }; network: { channel: number | null } } | null;
  };
}
interface BackupStatus {
  present: boolean;
  writtenAt: string | null;
  ageDays: number | null;
  stale: boolean;
  coordinatorIeee: string | null;
  lastDownloadAt: string | null;
  warnings: string[];
}
interface CoordinatorState {
  address: string;
  connected: boolean;
  backupIeee: string | null;
  sameIeee: boolean | null;
  info: Status['zigbee2mqtt']['info'];
}

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [coordinator, setCoordinator] = useState<CoordinatorState | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Status>('GET', '/api/status').then(setStatus, (e: ApiError) => setError(e.message));
    api<CoordinatorState>('GET', '/api/coordinator').then(setCoordinator, () => setCoordinator(null));
  }, []);
  useEffect(load, [load]);

  const info = status?.zigbee2mqtt.info;
  return (
    <>
      <div className="card card-body mb-3">
        <h2>Status</h2>
        {error && <p className="text-danger">{error}</p>}
        {status && (
          <table className="table table-sm align-middle">
            <tbody>
              <tr>
                <th>SynBee</th>
                <td>{status.version}</td>
              </tr>
              <tr>
                <th>Zigbee2MQTT</th>
                <td>
                  {status.zigbee2mqtt.bundled ? `${status.zigbee2mqtt.bundled} bundled` : 'not bundled'}
                  {info?.version ? `, ${info.version} running` : ', not running'}
                </td>
              </tr>
              <tr>
                <th>Coordinator</th>
                <td>
                  {coordinator?.address ? <code>tcp://{coordinator.address}</code> : <span className="muted">no address set</span>}
                  {info?.coordinator.type && ` · ${info.coordinator.type}${info.coordinator.firmware ? ` ${info.coordinator.firmware}` : ''}`}
                  {info?.coordinator.ieee && <span className="muted"> · {info.coordinator.ieee}</span>}
                </td>
              </tr>
              <tr>
                <th>Zigbee channel</th>
                <td>{info?.network.channel ?? <span className="muted">unknown</span>}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <p className="card card-body mb-3 muted">
        The coordinator, its backup, the network map and replacing it are on the <a href="#gateway">Gateway</a> page.
      </p>
      {status?.database && <UpgradesPanel db={status.database} />}
      <UnitsSettings />
      <LocationSettings />
      <HistorySettings />
      <LogsPanel />
      <p className="small muted mt-3">
        SynBee is free software under the MIT licence, provided "as is", without any warranty. Its authors accept no responsibility or liability for it under any
        circumstances; you use it at your own risk. Don't rely on it where a failure could endanger people, animals or property.
      </p>
      <p className="small muted">
        Made by Jacek Kijewski.{' '}
        <a href="https://github.com/jkijewski/synbee" target="_blank" rel="noreferrer">
          Source code and help
        </a>
        {' · '}
        <a href="https://github.com/jkijewski/synbee/issues" target="_blank" rel="noreferrer">
          Report a problem
        </a>
        {' · '}
        <a href="https://buycoffee.to/jacek-kijewski" target="_blank" rel="noreferrer">
          Buy me a coffee
        </a>
      </p>
    </>
  );
}

function LogsPanel() {
  const [name, setName] = useState('zigbee2mqtt');
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api<{ lines: string[] }>('GET', `/api/logs/${name}`).then((r) => setLines(r.lines), (e: ApiError) => setError(e.message));
  }, [name]);
  useEffect(load, [load]);
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Logs</h2>
        <select className="form-select form-select-sm" aria-label="Log" value={name} onChange={(e) => setName(e.target.value)}>
          <option value="zigbee2mqtt">Zigbee2MQTT</option>
          <option value="hub">Hub</option>
          <option value="supervisor">Supervisor</option>
        </select>
        <button className="btn btn-outline-secondary btn-sm" onClick={load}>Refresh</button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {lines && lines.length === 0 && <p className="muted">Empty.</p>}
      {lines && lines.length > 0 && <pre className="log">{lines.join('\n')}</pre>}
    </div>
  );
}

/** Upgrades and the copies taken before them, with how to go back (stop SynBee, put a copy in place, start an older version). */
function UpgradesPanel({ db }: { db: Database }) {
  const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
  return (
    <div className="card card-body mb-3">
      <h3 className="h5">Upgrades and safety copies</h3>
      <p className="small mb-2">
        Database version <strong>{db.version}</strong>
        {db.version === db.latest ? ' (current)' : ` of ${db.latest}`}. Each upgrade moves your data forward step by step, all or nothing; before it, SynBee copies the
        database, and the package copies each gateway's Zigbee2MQTT data. The last 3 of each are kept.
      </p>
      {db.upgrades.length > 0 && (
        <ul className="small mb-2">
          {db.upgrades.map((u) => (
            <li key={u.at}>
              {new Date(u.at).toLocaleString()}: version {u.fromVersion} → {u.toVersion}
              {u.snapshot ? `, copy ${u.snapshot}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="row small">
        <div className="col-md-6">
          <strong>Database copies</strong> (next to hub.db in the SynBee shared folder)
          {db.snapshots.length === 0 ? (
            <p className="text-body-secondary mb-0">None yet: one is made at the next upgrade that changes the database.</p>
          ) : (
            <ul className="mb-0">
              {db.snapshots.map((s) => (
                <li key={s.name}>
                  <code>{s.name}</code> · {mb(s.bytes)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="col-md-6">
          <strong>Zigbee2MQTT copies</strong> (in the package's private folder)
          {db.zigbee2mqttSnapshots.length === 0 ? (
            <p className="text-body-secondary mb-0">None yet: one is made before the next package upgrade.</p>
          ) : (
            <ul className="mb-0">
              {db.zigbee2mqttSnapshots.map((s) => (
                <li key={s}>
                  <code>{s}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <details className="small mt-2">
        <summary>Going back to an older version</summary>
        <p className="mt-2 mb-0">
          An older SynBee refuses a newer database, on purpose. To go back: stop SynBee in Package Center, uninstall it keeping its data, rename the copy made before the
          upgrade (e.g. <code>hub.db.before-v17-…</code>) to <code>hub.db</code> in the SynBee shared folder, and install the older package. Zigbee2MQTT's copies are needed
          only if its own data was damaged; ask for help before restoring one, as it holds the network key.
        </p>
      </details>
    </div>
  );
}

export function BackupPanel({ status, onChange, network = 1 }: { status: BackupStatus | null; onChange: () => void; network?: number }) {
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setMessage(null);
    if (passphrase !== again) return setMessage({ text: 'The two passphrases differ.', error: true });
    setBusy(true);
    try {
      const res = await fetch(onGateway('/api/backup/download', network), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, passphrase, understood }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status})`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'synbee-coordinator-backup.synbee-backup';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setPassword('');
      setPassphrase('');
      setAgain('');
      setMessage({ text: `Downloaded ${name}. Keep it off the NAS, with the passphrase stored separately.`, error: false });
      onChange();
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-body mb-3">
      <h2>Coordinator backup{network !== 1 ? ` (gateway ${network})` : ''}</h2>
      <details className="mb-2">
        <summary>What is this backup, and why download it?</summary>
        <div className="small mt-2">
          <p>
            Your Zigbee devices trust this gateway's network: its <strong>network key</strong>, its identity (PAN ID and address) and its list of devices. These live in the
            gateway's Zigbee2MQTT data on the NAS, and Zigbee2MQTT writes a backup of them by itself. Each gateway has its own network, so each has its own backup.
          </p>
          <p>The backup is what lets you recover without pairing every device again:</p>
          <ul>
            <li>
              <strong>The coordinator breaks or is replaced:</strong> use "Replace the gateway" below with a coordinator of the same chip family; the network is moved onto
              it from this backup.
            </li>
            <li>
              <strong>The NAS is lost or reinstalled:</strong> install SynBee again and restore the downloaded file with its passphrase.
            </li>
          </ul>
          <p>
            The copy on the NAS is useless if the NAS itself is gone, so <strong>download a copy</strong> after setting up and after big changes (new devices, a new
            gateway), and keep it off the NAS: on your computer, a USB stick or a password manager. The file is encrypted with a passphrase you choose; SynBee never
            keeps the passphrase. Without the file, a lost network means pairing every device again.
          </p>
        </div>
      </details>
      {!status ? (
        <p className="muted">Not available.</p>
      ) : (
        <>
          <p>
            {status.present ? (
              <>
                Last written {new Date(status.writtenAt!).toLocaleString()} ({status.ageDays} days ago).
                {status.lastDownloadAt ? ` Last downloaded ${new Date(status.lastDownloadAt).toLocaleString()}.` : ' Never downloaded.'}
              </>
            ) : (
              'No backup yet.'
            )}
          </p>
          {status.warnings.map((w, i) => (
            <p key={i} className={status.stale ? 'text-danger' : 'text-warning-emphasis'}>
              {w}
            </p>
          ))}
          {status.present && (
            <div className="step">
              <h3>Download a copy</h3>
              <p className="small">
                The file contains your Zigbee network key. Anyone with the file and its passphrase can read and control your Zigbee network. It is
                encrypted with the passphrase you choose here, which SynBee doesn't keep: if you forget it, the copy is useless.
              </p>
              <label>
                Admin password
                <input className="form-control form-control-sm" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>
                Passphrase for the file (at least 12 characters)
                <input className="form-control form-control-sm" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </label>
              <label>
                Passphrase again
                <input className="form-control form-control-sm" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              </label>
              <label className="line">
                <input className="form-check-input" type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I understand the file holds the key to my Zigbee network
              </label>
              <button className="btn btn-primary btn-sm" disabled={busy || !understood || passphrase.length < 12 || !password} onClick={() => void download()}>
                Download encrypted backup
              </button>
            </div>
          )}
          {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
        </>
      )}
    </div>
  );
}

export function ReplacePanel({ state, onChange, network = 1 }: { state: CoordinatorState | null; onChange: () => void; network?: number }) {
  const [address, setAddress] = useState('');
  const [oldDisconnected, setOldDisconnected] = useState(false);
  const [sameChipFamily, setSameChipFamily] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [found, setFound] = useState<Array<{ name: string; address: string }> | null>(null);
  const [searching, setSearching] = useState(false);
  if (!state) return null;

  const find = async () => {
    setSearching(true);
    setFound(null);
    try {
      setFound((await api<{ found: Array<{ name: string; address: string }> }>('GET', '/api/gateway/discover')).found);
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    } finally {
      setSearching(false);
    }
  };

  const replace = async () => {
    setMessage(null);
    try {
      const r = await api<{ address: string; restarted: boolean }>('POST', onGateway('/api/coordinator/replace', network), { address, oldDisconnected, sameChipFamily });
      setMessage({
        text: r.restarted ? `Zigbee2MQTT is restarting with tcp://${r.address}. Check the result below in a minute.` : `Saved tcp://${r.address}; restart the package to use it.`,
        error: false,
      });
      setTimeout(onChange, 15000);
      onChange();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };
  const restore = async () => {
    if (!file) return;
    setMessage(null);
    try {
      const r = await api<{ coordinatorIeee: string | null; restarting: boolean }>('POST', onGateway('/api/backup/restore', network), { archive: await toBase64(file), passphrase, password });
      setPassphrase('');
      setPassword('');
      setMessage({ text: `Backup accepted (network of coordinator ${r.coordinatorIeee ?? 'unknown'}). ${r.restarting ? 'Zigbee2MQTT is restarting with it.' : 'Restart the package to use it.'}`, error: false });
      setTimeout(onChange, 15000);
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  return (
    <div className="card card-body mb-3">
      <h2>Replace the gateway</h2>
      <p className="muted small">
        Only when the gateway (the Zigbee coordinator) has failed. Devices keep working without pairing again, because the network is restored from the
        backup. A Zigbee network has exactly one coordinator; a second gateway for the same network isn't possible.
      </p>
      {state.backupIeee && state.info?.coordinator.ieee && (
        <p className={state.sameIeee ? 'text-success' : 'text-danger'}>
          {state.sameIeee
            ? `The coordinator in use carries the network's address ${state.backupIeee}.`
            : `The coordinator in use (${state.info.coordinator.ieee}) differs from the backup's (${state.backupIeee}): devices may need their reporting set up again under Devices.`}
        </p>
      )}
      <ol className="small mb-3">
        <li>Make sure you have a backup: the latest one is kept on the NAS; if this NAS lost its data, restore a downloaded one first (below).</li>
        <li>Disconnect the old gateway for good. Two coordinators with the same network break it.</li>
        <li>Connect a new one of the same kind (Silicon Labs chip, EmberZNet firmware, such as another SLZB-06MU), and reserve its address on the router.</li>
        <li>Enter its address, or find it on the network, then confirm.</li>
      </ol>
      <div className="row g-2 align-items-end mb-2">
        <div className="col-sm-6 col-lg-4">
          <label className="form-label small mb-1" htmlFor={`replace-address-${network}`}>
            New gateway address (host:port)
          </label>
          <input
            id={`replace-address-${network}`}
            className="form-control form-control-sm"
            value={address}
            placeholder={state.address || '192.168.1.50:6638'}
            onChange={(e) => setAddress(e.target.value.trim())}
          />
        </div>
        <div className="col-auto">
          <button className="btn btn-outline-secondary btn-sm" disabled={searching} onClick={() => void find()}>
            {searching ? 'Looking…' : 'Find on network'}
          </button>
        </div>
      </div>
      {found && found.length === 0 && <p className="muted small mb-2">No gateway announced itself. Enter its address by hand; it's shown in the gateway's own web page and on the router.</p>}
      {found && found.length > 0 && (
        <div className="d-flex flex-wrap align-items-center gap-2 small mb-2">
          Found:
          {found.map((f) => (
            <button className="btn btn-outline-secondary btn-sm" key={f.address} onClick={() => setAddress(f.address)}>
              {f.name} ({f.address})
            </button>
          ))}
        </div>
      )}
      <div className="form-check mb-1">
        <input className="form-check-input" type="checkbox" id={`replace-old-${network}`} checked={oldDisconnected} onChange={(e) => setOldDisconnected(e.target.checked)} />
        <label className="form-check-label" htmlFor={`replace-old-${network}`}>
          The old gateway is disconnected for good
        </label>
      </div>
      <div className="form-check mb-3">
        <input className="form-check-input" type="checkbox" id={`replace-chip-${network}`} checked={sameChipFamily} onChange={(e) => setSameChipFamily(e.target.checked)} />
        <label className="form-check-label" htmlFor={`replace-chip-${network}`}>
          The new one has the same chip family (Silicon Labs, EmberZNet)
        </label>
      </div>
      <div className="mb-4">
        <button className="btn btn-primary btn-sm" disabled={!address || !oldDisconnected || !sameChipFamily} onClick={() => void replace()}>
          Use the new gateway
        </button>
      </div>
      <div className="border-top pt-3">
        <h3 className="h5 mb-2">Restore a downloaded backup</h3>
        <p className="small mb-3">For a fresh install or a new NAS. It replaces Zigbee2MQTT's network data; the current data is kept aside in the private folder.</p>
        <div className="row g-3 mb-3">
          <div className="col-12">
            <label className="form-label small mb-1" htmlFor={`restore-file-${network}`}>
              Backup file
            </label>
            <input id={`restore-file-${network}`} className="form-control form-control-sm" type="file" accept=".synbee-backup" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="col-sm-6">
            <label className="form-label small mb-1" htmlFor={`restore-passphrase-${network}`}>
              The file's passphrase
            </label>
            <input id={`restore-passphrase-${network}`} className="form-control form-control-sm" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
          <div className="col-sm-6">
            <label className="form-label small mb-1" htmlFor={`restore-password-${network}`}>
              Admin password
            </label>
            <input
              id={`restore-password-${network}`}
              className="form-control form-control-sm"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-outline-secondary btn-sm" disabled={!file || !passphrase || !password} onClick={() => void restore()}>
          Restore
        </button>
      </div>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
    </div>
  );
}

/** Celsius or Fahrenheit, for the app, its tiles and notification texts. */
function UnitsSettings() {
  const units = useApi<{ temperature: 'C' | 'F' }>('/api/units');
  const [error, setError] = useState('');
  if (!units.data) return null;
  return (
    <div className="card card-body mb-3">
      <h3>Units</h3>
      <div className="line">
        <label className="line mb-0" htmlFor="unit-temp">
          Temperatures in
        </label>
        <select
          id="unit-temp"
          className="form-select form-select-sm"
          style={{ width: 'auto' }}
          value={units.data.temperature}
          onChange={(e) => void api('PUT', '/api/units', { temperature: e.target.value }).then(units.reload, (er: ApiError) => setError(er.message))}
        >
          <option value="C">Celsius (°C)</option>
          <option value="F">Fahrenheit (°F)</option>
        </select>
      </div>
      <p className="small text-body-secondary mb-0 mt-1">Used in the app, its tiles and notification texts. Devices report Celsius; SynBee converts.</p>
      {error && <p className="text-danger small mb-0">{error}</p>}
    </div>
  );
}
