import { useEffect, useState } from 'react';
import { api, ApiError, type ImportResult, type LightGroup, type Room } from './api';
import { ItemLink } from './Related';

export function Import() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [previous, setPrevious] = useState<(ImportResult & { at: string }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<(ImportResult & { at: string }) | null>('GET', '/api/import/tuya/report').then(setPrevious, () => undefined);
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api<ImportResult>('POST', '/api/import/tuya', await file.text()));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = result ?? previous;
  return (
    <div className="card card-body mb-3">
      <h2>Import from Tuya</h2>
      <p className="muted">
        Choose the configuration export (tuya-config-export-….json, from tools/tuya-export) to import rooms, names, channel labels, the light group, scenes as
        draft actions and automations as disabled draft rules. A tinytuya devices.json imports names only. Keys in the files are ignored and never stored.
        Importing again doesn't duplicate anything.
      </p>
      <input className="form-control form-control-sm" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
      {error && <p className="text-danger">{error}</p>}
      {!result && previous && <p className="muted">Last import: {new Date(previous.at).toLocaleString()}</p>}
      {shown && <Report r={shown} />}
    </div>
  );
}

function Report({ r }: { r: ImportResult }) {
  const [ids, setIds] = useState<{ actions: Map<string, number>; rules: Map<string, number>; groups: Map<string, number>; rooms: Map<string, number>; devices: Map<string, string> }>();
  useEffect(() => {
    void Promise.all([
      api<Array<{ id: number; name: string }>>('GET', '/api/actions'),
      api<Array<{ id: number; name: string }>>('GET', '/api/rules'),
      api<LightGroup[]>('GET', '/api/groups'),
      api<Room[]>('GET', '/api/rooms'),
      api<Array<{ ieee: string; name: string }>>('GET', '/api/devices'),
    ]).then(([actions, rules, groups, rooms, devices]) =>
      setIds({
        actions: new Map(actions.map((x) => [x.name, x.id])),
        rules: new Map(rules.map((x) => [x.name, x.id!])),
        groups: new Map(groups.map((x) => [x.name, x.id])),
        rooms: new Map(rooms.map((x) => [x.name, x.id])),
        devices: new Map(devices.map((x) => [x.name, x.ieee])),
      }),
    );
  }, [r]);
  // Names become links to their pages once the hub has them.
  const link = (kind: 'device' | 'action' | 'rule' | 'group' | 'room', name: string, id: string | number | undefined) =>
    id === undefined ? (
      name
    ) : (
      <ItemLink kind={kind} id={id}>
        {name}
      </ItemLink>
    );
  const list = (title: string, items: React.ReactNode[] | undefined) =>
    items && items.length > 0 ? (
      <>
        <h3>{title}</h3>
        <ul>
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <div>
      <p className="text-success">
        Devices: {r.imported.length} imported, {r.updated.length} updated, {r.skipped.length} skipped.
      </p>
      {list('Rooms', r.rooms?.map((n) => link('room', n, ids?.rooms.get(n))))}
      {list('Devices', [...r.imported, ...r.updated].map((d) => link('device', d.name, d.ieee)))}
      {list('Channel labels', r.labels?.map((l) => <>{link('device', l.device, ids?.devices.get(l.device))} {l.endpoint}: {l.label}</>))}
      {list('Light groups (create them when their bulbs have moved)', r.groups?.map((g) => <>{link('group', g.name, ids?.groups.get(g.name))}: {g.note}</>))}
      {list('Draft actions', r.actions?.map((a) => <>{link('action', a.name, ids?.actions.get(a.name))}. {a.notes}</>))}
      {list('Disabled draft rules', r.rules?.map((a) => <>{link('rule', a.name, ids?.rules.get(a.name))}. {a.notes}</>))}
      {list('Settings to re-apply by hand after the device joins', r.settings?.map((s) => <>{link('device', s.device, ids?.devices.get(s.device))}: {s.setting} = {s.value}</>))}
      {list('Not imported', [...r.skipped, ...(r.notImported ?? [])].map((s) => `${s.name}: ${s.reason}`))}
    </div>
  );
}
