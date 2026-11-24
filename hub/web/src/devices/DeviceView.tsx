import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, propertyLabel, type DeviceDetail, type Property, type Room } from '../api';
import { Icon, IconPicker } from '../Icons';
import { LightState } from '../LightState';
import { confirmDelete, ItemLink, Related, RoomChips } from '../Related';
import { featureUI } from '../features';
import { withLightOn } from '../../../src/features/index.js';
import { ChannelLabels } from './ChannelLabels';
import { EnergyCard } from '../history/EnergyCard';
import { HistoryChart } from '../history/HistoryChart';
import { RoomSelect } from './RoomPickers';
import { useApi } from '../useApi';

// One device: controls, settings, rooms, icon, channel labels and related items.
export function DeviceView({ ieee, onBack }: { ieee: string; onBack: () => void }) {
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [name, setName] = useState('');
  const roomsApi = useApi<Room[]>('/api/rooms');
  const rooms = roomsApi.data ?? [];
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // The name as last loaded: a reload (after a room change, say) refreshes the field only if it wasn't edited.
  const loadedName = useRef<string | null>(null);
  const load = useCallback(() => {
    api<DeviceDetail>('GET', `/api/devices/${ieee}`).then(
      (d) => {
        setDevice(d);
        const previous = loadedName.current;
        loadedName.current = d.name;
        setName((current) => (previous === null || current === previous ? d.name : current));
      },
      (e: ApiError) => setMessage({ text: e.message, error: true }),
    );
  }, [ieee]);
  // After a change, rooms are fetched again too (a device's move changes room lists).
  const reloadAll = useCallback(() => {
    load();
    roomsApi.reload();
  }, [load, roomsApi.reload]);
  // Another device: its own name, whatever was typed for the previous one.
  useEffect(() => {
    loadedName.current = null;
  }, [ieee]);
  useEffect(load, [load]);
  // The state follows the device while the page is open: rules, remotes and the device's own buttons change it.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async () => {
    try {
      await api('PATCH', `/api/devices/${ieee}`, { name });
      setMessage({ text: 'Saved.', error: false });
      reloadAll();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const setRooms_ = async (body: { room?: number | null; also?: number[] }) => {
    setMessage(null);
    try {
      await api('PUT', `/api/devices/${ieee}/rooms`, body);
      reloadAll();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const send = async (asked: Record<string, unknown>) => {
    const values = withLightOn(device?.properties ?? [], asked);
    setMessage(null);
    try {
      let r: { state: Record<string, unknown> };
      try {
        r = await api<{ state: Record<string, unknown> }>('POST', `/api/devices/${ieee}/command`, values);
      } catch (err) {
        // Unlocking and similar commands: ask, then send again confirmed.
        if (!(err instanceof ApiError && err.confirm)) throw err;
        if (!window.confirm(err.confirm)) return;
        r = await api<{ state: Record<string, unknown> }>('POST', `/api/devices/${ieee}/command?confirmed=1`, values);
      }
      setDevice((d) => (d ? { ...d, state: r.state } : d));
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  // Zigbee2MQTT reads the device's details again (its "interview"); for devices that joined but weren't recognised.
  const interview = async () => {
    setMessage({ text: 'Reading the device again; this can take up to a minute…', error: false });
    try {
      await api('POST', `/api/devices/${ieee}/interview`);
      setMessage({ text: 'Done.', error: false });
      load();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const refresh = async () => {
    setMessage(null);
    try {
      const r = await api<{ state: Record<string, unknown> }>('POST', `/api/devices/${ieee}/refresh`);
      setDevice((d) => (d ? { ...d, state: r.state } : d));
      setMessage({ text: 'Refreshed.', error: false });
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  if (!device) return <p className="card card-body mb-3 muted">{message?.text ?? 'Loading…'}</p>;
  return (
    <>
      <button className="btn btn-outline-secondary btn-sm" onClick={onBack}>← All devices</button>
      <div className="card card-body mb-3">
        <h2 className="line">
          <span className="device-icon">
            <Icon name={device.icon ?? 'question_mark'} size="2rem" />
          </span>
          {device.name}
          <RoomChips roomId={device.roomId} alsoRooms={device.alsoRooms} rooms={rooms} />
        </h2>
        <p className="muted">
          {device.ieee} · {device.status === 'pending' ? 'waiting to be paired' : 'paired'}
          {device.model && ` · ${device.vendor ?? ''} ${device.model}`}
        </p>
        {device.light && (
          <p className="mb-2">
            <LightState light={device.light} large />
          </p>
        )}
        {(device.timers ?? []).map((t) => (
          <p key={`${t.ruleId}/${t.step}`} className="small text-info-emphasis mb-1 line">
            <span>
              Timer: {t.what.replace(/^Set [^:]*: /, '')} in {Math.max(0, Math.ceil((t.dueAt - Date.now()) / 60_000))} min (automation{' '}
              <ItemLink kind="rule" id={t.ruleId}>
                {t.rule}
              </ItemLink>
              )
            </span>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => void api('DELETE', `/api/rules/${t.ruleId}/timers/${t.step}`).then(load, (e: ApiError) => setMessage({ text: e.message, error: true }))}
            >
              Cancel timer
            </button>
          </p>
        ))}
        {device.online === false && <p className="text-danger">Zigbee2MQTT reports this device as offline.</p>}
        {device.status === 'joined' && !device.recognised && (
          <p className="text-danger">
            This device paired but isn't recognised, so it has no controls. Reported model: {device.raw?.modelId ?? device.model ?? 'unknown'}, maker:{' '}
            {device.raw?.manufacturer ?? device.vendor ?? 'unknown'}
            {device.raw?.interviewCompleted === false && ', and its setup (interview) did not finish'}.{' '}
            <button className="btn btn-outline-secondary btn-sm" onClick={() => void interview()}>
              Read its details again
            </button>
          </p>
        )}
        <div className="line">
          <label>
            Name
            <input className="form-control form-control-sm" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn btn-primary btn-sm" disabled={name.trim() === device.name} onClick={() => void save()}>
            Save name
          </button>
          <label>
            Room
            <RoomSelect rooms={rooms} value={device.roomId ?? null} onChange={(room) => void setRooms_({ room })} />
          </label>
        </div>
        {rooms.length > 1 && (
          <details className="also-rooms" open={(device.alsoRooms ?? []).length > 0}>
            <summary>Also show in other rooms</summary>
            <p className="muted small">For a device that serves more than one room, such as a hall light. Its main room stays {device.room ?? 'unset'}.</p>
            <div className="line">
              {rooms
                .filter((r) => r.id !== device.roomId)
                .map((r) => (
                  <label key={r.id} className="line">
                    <input className="form-check-input"
                      type="checkbox"
                      checked={(device.alsoRooms ?? []).includes(r.id)}
                      onChange={(e) => {
                        const now = device.alsoRooms ?? [];
                        void setRooms_({ also: e.target.checked ? [...now, r.id] : now.filter((x) => x !== r.id) });
                      }}
                    />
                    {r.name}
                  </label>
                ))}
            </div>
          </details>
        )}
        {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      </div>
      {device.properties.length > 0 && (
        <div className="card card-body mb-3">
          <div className="line">
            <h3 style={{ marginRight: 'auto' }}>Controls</h3>
            {device.properties.some((p) => p.gettable) && (
              <button className="btn btn-outline-secondary btn-sm" onClick={() => void refresh()} title="Ask the device for its current values">
                Refresh
              </button>
            )}
          </div>
          <PropertyTable properties={device.properties.filter((p) => !p.category)} device={device} send={send} />
          {(['config', 'diagnostic'] as const).map((category) => {
            const list = device.properties.filter((p) => p.category === category);
            return (
              list.length > 0 && (
                <details key={category} className="mt-2">
                  <summary>
                    {category === 'config' ? 'Settings' : 'Diagnostics'} ({list.length})
                  </summary>
                  <PropertyTable properties={list} device={device} send={send} />
                </details>
              )
            );
          })}
        </div>
      )}
      {device.properties.some((p) => p.property === 'energy') && <EnergyCard ieee={ieee} />}
      <HistoryChart ieee={ieee} properties={device.properties} labels={device.labels} />
      <div className="card card-body mb-3">
        <h3>Icon</h3>
        <p className="muted small">{device.iconChosen ? 'Chosen by you.' : "Chosen automatically from the device's type."}</p>
        <IconPicker
          value={device.icon ?? ''}
          auto={device.autoIcon ?? 'question_mark'}
          onPick={(icon) =>
            void api('PATCH', `/api/devices/${ieee}`, { icon }).then(load, (e: ApiError) => setMessage({ text: e.message, error: true }))
          }
        />
      </div>
      <ChannelLabels device={device} onSaved={load} />
      <Related kind="device" id={ieee} refresh={device} />
      <div className="card card-body mb-3">
        <h3>Forget this device</h3>
        <p className="muted small">
          {device.status === 'joined'
            ? 'SynBee asks the device to leave the Zigbee network; it then looks for a network again, so it can be added back or returned to Tuya.'
            : 'Removes the imported entry. The device itself is not touched.'}
        </p>
        <button className="btn btn-outline-secondary btn-sm"
          onClick={async () => {
            if (!(await confirmDelete('device', ieee, device.name))) return;
            try {
              await api('DELETE', `/api/devices/${ieee}`);
              onBack();
            } catch (err) {
              setMessage({ text: (err as ApiError).message, error: true });
            }
          }}
        >
          Forget device
        </button>
      </div>
      {device.events.length > 0 && (
        <div className="card card-body mb-3">
          <h3>Buttons</h3>
          <p className="muted small">Presses this device reports, as rules see them.</p>
          <ul className="small">
            {device.events.map((e) => (
              <li key={e.raw}>{e.button ? `button ${e.button}, ${e.press?.replace('_', ' ')} (${e.raw})` : e.raw}</li>
            ))}
          </ul>
        </div>
      )}
      {device.status === 'joined' && (
        <div className="card card-body mb-3">
          <h3>Reporting</h3>
          <p className="muted small">If the device stopped reporting its state, for example after the coordinator was replaced, set up its reporting again.</p>
          <button className="btn btn-outline-secondary btn-sm"
            onClick={() =>
              void api('POST', `/api/devices/${ieee}/configure`).then(
                () => setMessage({ text: 'Reporting set up again.', error: false }),
                (e: ApiError) => setMessage({ text: e.message, error: true }),
              )
            }
          >
            Set up reporting again
          </button>
        </div>
      )}
    </>
  );
}

/** One table of a device's properties: name, current value, and a control when it can be set. */
function PropertyTable({ properties, device, send }: { properties: Property[]; device: DeviceDetail; send: (v: Record<string, unknown>) => Promise<void> }) {
  if (properties.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table table-sm align-middle">
        <tbody>
          {properties.map((p) => {
            const ui = featureUI(p);
            return (
              <tr key={p.property}>
                <th>{propertyLabel(p, device.labels)}</th>
                <td>
                  <ui.Display prop={p} value={device.state[p.property]} />
                </td>
                <td>{p.writable && <ui.Control prop={p} value={device.state[p.property]} onSend={send} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
