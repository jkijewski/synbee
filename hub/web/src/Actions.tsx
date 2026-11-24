import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Action, type Choices, type DeviceRow, type RunResult, type Step, type TileShow } from './api';
import { ACTION_ICONS, Icon, IconPicker } from './Icons';
import { byRoom } from './byRoom';
import { confirmDelete, ItemLink, Related, useHashId } from './Related';
import { ItemRooms, RoomSections, useRooms } from './RoomSections';
import type { LightGroup } from './api';
import { ValuesEditor } from './Values';
import { MemberAccess } from './MemberAccess';
import { ConditionEditor } from './rules/ConditionEditor';
import { defaultCondition, Item } from './rules/RuleParts';

const blank = (): Omit<Action, 'id'> => ({ name: '', icon: 'bolt', description: '', order: 0, draft: false, notes: '', if: { mode: 'all', conditions: [] }, steps: [] });

/** What the action's tile shows in the app: worked out from its steps, nothing, a light group's look or one device value. */
function TileEditor({ tile, choices, onChange }: { tile: TileShow; choices: Choices | null; onChange: (t: TileShow) => void }) {
  const value = tile.show === 'device' ? `device:${tile.device}` : tile.show === 'group' ? `group:${tile.group}` : tile.show;
  const device = tile.show === 'device' ? choices?.devices.find((d) => d.ieee === tile.device) : undefined;
  const readable = (d: Choices['devices'][number]) => d.properties.filter((p) => p.readable && !p.category);
  return (
    <div className="line mt-2" style={{ flexWrap: 'wrap' }}>
      <label className="line">
        On the app's tile
        <select
          className="form-select form-select-sm"
          style={{ width: 'auto' }}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'auto' || v === 'none') return onChange({ show: v });
            if (v.startsWith('group:')) return onChange({ show: 'group', group: Number(v.slice(6)) });
            const d = choices?.devices.find((x) => x.ieee === v.slice(7));
            const first = d ? readable(d)[0]?.property : undefined;
            if (d && first) onChange({ show: 'device', device: d.ieee, property: first });
          }}
        >
          <option value="auto">Automatic: what it switches</option>
          <option value="none">Nothing</option>
          <optgroup label="A light group">
            {choices?.groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="A device's value">
            {choices?.devices
              .filter((d) => readable(d).length > 0)
              .map((d) => (
                <option key={d.ieee} value={`device:${d.ieee}`}>
                  {d.name}
                  {d.room ? ` (${d.room})` : ''}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      {tile.show === 'device' && device && (
        <select className="form-select form-select-sm" style={{ width: 'auto' }} aria-label="Value shown" value={tile.property} onChange={(e) => onChange({ ...tile, property: e.target.value })}>
          {readable(device).map((p) => (
            <option key={p.property} value={p.property}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function Actions() {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [newAction, setNewAction] = useState<Omit<Action, 'id'> | null>(null);
  const [openId, setOpenId] = useHashId();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [devices, setDevices] = useState<Record<string, DeviceRow>>({});
  const [groups, setGroups] = useState<Record<number, LightGroup>>({});
  const { rooms, membership } = useRooms(actions);

  const load = useCallback(() => {
    api<Action[]>('GET', '/api/actions').then(setActions, (e: ApiError) => setMessage({ text: e.message, error: true }));
    api<DeviceRow[]>('GET', '/api/devices').then((rows) => setDevices(Object.fromEntries(rows.map((d) => [d.ieee, d]))), () => undefined);
    api<LightGroup[]>('GET', '/api/groups').then((rows) => setGroups(Object.fromEntries(rows.map((g) => [g.id, g]))), () => undefined);
  }, []);
  // The devices and groups an action switches, shown as small icons on its card.
  const targets = (a: Action) => {
    const seen = new Map<string, { icon: string; title: string; kind: 'device' | 'group'; id: string | number }>();
    for (const st of a.steps) {
      if (st.kind === 'device') seen.set(st.device, { icon: devices[st.device]?.icon ?? 'question_mark', title: devices[st.device]?.name ?? st.device, kind: 'device', id: st.device });
      if (st.kind === 'group') seen.set(`g${st.group}`, { icon: 'light_group', title: groups[st.group]?.name ?? 'light group', kind: 'group', id: st.group });
    }
    return [...seen.entries()];
  };
  useEffect(load, [load]);

  const run = async (a: Action) => {
    setMessage(null);
    try {
      const r = await api<RunResult>('POST', `/api/actions/${a.id}/run`);
      setMessage(r.ok ? { text: `"${a.name}" ran.`, error: false } : r.notRun ? { text: `"${a.name}" not run: ${r.notRun}`, error: true } : { text: `"${a.name}": ${r.error}`, error: true });
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const remove = async (a: Action) => {
    if (!(await confirmDelete('action', a.id, a.name))) return;
    try {
      await api('DELETE', `/api/actions/${a.id}`);
      load();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };

  const opened = openId !== null ? actions?.find((a) => String(a.id) === openId) : undefined;
  if (newAction) return <ActionEditor initial={newAction} onDone={() => (setNewAction(null), load())} />;
  if (opened) return <ActionEditor key={opened.id} initial={opened} onDone={() => (setOpenId(null), load())} />;
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Actions</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setNewAction(blank())}>
          New action
        </button>
      </div>
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      {actions && actions.length === 0 && <p className="muted">No actions yet.</p>}
      <RoomSections
        items={actions ?? []}
        rooms={rooms}
        roomsOf={(a) => membership?.actions[String(a.id)] ?? []}
        render={(a, inRooms) => (
          <div className="card" key={a.id}>
            <div className="line">
              <span className="icon" aria-hidden>
                {a.icon}
              </span>
              <strong>
                <ItemLink kind="action" id={a.id}>
                  {a.name}
                </ItemLink>
              </strong>
              <ItemRooms ids={inRooms} rooms={rooms} />
            </div>
            {a.description && <span className="muted">{a.description}</span>}
            <div className="line muted">
              {targets(a).map(([key, t]) => (
                <ItemLink key={key} kind={t.kind} id={t.id}>
                  <Icon name={t.icon} title={t.title} /> <span className="small">{t.title}</span>
                </ItemLink>
              ))}
            </div>
            <div className="line">
              {a.draft && <span className="badge rounded-pill text-bg-warning">draft from Tuya</span>}
              <span className="badge rounded-pill text-bg-light border">
                {a.steps.length} step{a.steps.length === 1 ? '' : 's'}
              </span>
            </div>
            {a.readiness && !a.readiness.ready && <span className="muted">Waiting for: {a.readiness.missing.join(', ')}</span>}
            {a.draft && a.readiness?.ready && <span className="text-success">Ready: all its devices have moved. Check it, then save it as checked.</span>}
            {a.notes && <span className="muted small">{a.notes}</span>}
            <div className="line">
              <button className="btn btn-primary btn-sm" onClick={() => void run(a)}>
                Run
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setOpenId(a.id)}>Edit</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => void remove(a)}>Delete</button>
            </div>
          </div>
        )}
      />
    </div>
  );
}

function ActionEditor({ initial, onDone }: { initial: Omit<Action, 'id'> & { id?: number }; onDone: () => void }) {
  const [a, setA] = useState(initial);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Choices>('GET', '/api/rule-choices').then(setChoices, (e: ApiError) => setError(e.message));
  }, []);

  const setStep = (i: number, step: Step) => setA({ ...a, steps: a.steps.map((s, j) => (j === i ? step : s)) });
  const save = async () => {
    setError('');
    const body = a;
    try {
      if (a.id) await api('PUT', `/api/actions/${a.id}`, body);
      else await api('POST', '/api/actions', body);
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  const devices = choices?.devices.filter((d) => d.properties.some((p) => p.writable) || a.steps.some((s) => s.kind === 'device' && s.device === d.ieee)) ?? [];

  return (
    <div className="card card-body mb-3">
      <h2>{a.id ? 'Edit action' : 'New action'}</h2>
      <div className="line">
        <label>
          Name
          <input className="form-control form-control-sm" value={a.name} maxLength={60} onChange={(e) => setA({ ...a, name: e.target.value })} />
        </label>
        <label>
          Icon
          <button
            type="button"
            className={`btn btn-sm ${pickingIcon ? 'btn-secondary' : 'btn-outline-secondary'} action-icon-button`}
            title="Choose an icon"
            aria-expanded={pickingIcon}
            onClick={() => setPickingIcon(!pickingIcon)}
          >
            <Icon name={a.icon} size="1.3rem" /> <span className="small">{pickingIcon ? 'Close' : 'Change'}</span>
          </button>
        </label>
        <label>
          Order
          <input className="form-control form-control-sm" type="number" value={a.order} onChange={(e) => setA({ ...a, order: Number(e.target.value) || 0 })} style={{ width: '6rem' }} />
        </label>
      </div>
      {pickingIcon && (
        <div className="card card-body mb-2">
          <IconPicker
            value={a.icon}
            suggestions={ACTION_ICONS}
            onPick={(icon) => {
              if (icon) setA({ ...a, icon });
              setPickingIcon(false);
            }}
          />
        </div>
      )}
      <label>
        Description
        <textarea className="form-control" value={a.description} maxLength={300} rows={2} onChange={(e) => setA({ ...a, description: e.target.value })} />
      </label>
      {a.notes && (
        <p className="muted small">
          <strong>Import notes:</strong> {a.notes}
        </p>
      )}
      <div className="line">
        {initial.draft && (
          <label className="line">
            <input className="form-check-input" type="checkbox" checked={!a.draft} onChange={(e) => setA({ ...a, draft: !e.target.checked })} />
            I've checked it (no longer a draft)
          </label>
        )}
      </div>
      {a.id && !a.draft ? <MemberAccess kind="action" id={a.id} /> : null}
      <TileEditor tile={a.tile ?? { show: 'auto' }} choices={choices} onChange={(tile) => setA({ ...a, tile })} />
      <OnlyWhen value={a.if ?? { mode: 'all', conditions: [] }} choices={choices} onChange={(cond) => setA({ ...a, if: cond })} />
      <h3>Steps</h3>
      {a.steps.map((step, i) => {
        const device = step.kind === 'device' ? devices.find((d) => d.ieee === step.device) : undefined;
        const group = step.kind === 'group' ? choices?.groups.find((g) => g.id === step.group) : undefined;
        return (
          <div className="card mb-2" key={i}>
            <div className="card-body py-2">
              {/* Header: step number, what it switches (with a link), and Remove, on one grid row. */}
              <div className="row g-2 align-items-center mb-2">
                <div className="col-auto fw-semibold">Step {i + 1}</div>
                <div className="col-12 col-sm">
                  <div className="input-group input-group-sm">
                    {step.kind === 'device' ? (
                      <select className="form-select" aria-label="Device" value={step.device} onChange={(e) => setStep(i, { kind: 'device', device: e.target.value, values: {} })}>
                        <option value="" disabled>
                          choose a device…
                        </option>
                        {byRoom(devices).map(([room, list]) => (
                          <optgroup key={room} label={room}>
                            {list.map((d) => (
                              <option key={d.ieee} value={d.ieee}>
                                {d.name}
                                {d.status === 'pending' ? ' (not moved yet)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    ) : (
                      <select className="form-select" aria-label="Light group" value={step.group} onChange={(e) => setStep(i, { kind: 'group', group: Number(e.target.value), values: {} })}>
                        {choices?.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                            {g.created ? '' : ' (not created yet)'}
                          </option>
                        ))}
                      </select>
                    )}
                    {(step.kind === 'device' ? Boolean(step.device) : true) && (
                      <a
                        className="btn btn-outline-secondary"
                        href={step.kind === 'device' ? `#devices/${encodeURIComponent(step.device)}` : `#groups/${step.group}`}
                        title={step.kind === 'device' ? 'Open this device' : 'Open this light group'}
                        aria-label={step.kind === 'device' ? 'Open this device' : 'Open this light group'}
                      >
                        <span className="icon" aria-hidden="true">
                          open_in_new
                        </span>
                      </a>
                    )}
                  </div>
                </div>
                <div className="col-auto">
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setA({ ...a, steps: a.steps.filter((_, j) => j !== i) })}>
                    Remove step
                  </button>
                </div>
              </div>
              {step.kind === 'device' ? (
                <ValuesEditor properties={device?.properties ?? []} labels={device?.labels} values={step.values} onChange={(values) => setStep(i, { ...step, values })} canFade={device?.fades !== false} />
              ) : (
                <ValuesEditor properties={group?.properties ?? []} values={step.values} onChange={(values) => setStep(i, { ...step, values })} canFade={group?.fades !== false} />
              )}
            </div>
          </div>
        );
      })}
      <div className="line">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => setA({ ...a, steps: [...a.steps, { kind: 'device', device: devices.find((d) => d.status === 'joined')?.ieee ?? '', values: {} }] })}>
          Add device step
        </button>
        {(choices?.groups.length ?? 0) > 0 && (
          <button className="btn btn-outline-secondary btn-sm" onClick={() => setA({ ...a, steps: [...a.steps, { kind: 'group', group: choices!.groups[0]!.id, values: {} }] })}>Add light group step</button>
        )}
      </div>
      {error && <p className="text-danger">{error}</p>}
      <div className="line" style={{ marginTop: '1rem' }}>
        <button className="btn btn-primary btn-sm" onClick={() => void save()}>
          Save
        </button>
        <button className="btn btn-outline-secondary btn-sm" onClick={onDone}>Cancel</button>
      </div>
      {a.id !== undefined && <Related kind="action" id={a.id} />}
    </div>
  );
}

/** The action's IF (0011): checked when it is tapped; unmet, it doesn't run, and the person who tapped is told what wasn't true. */
function OnlyWhen({ value, choices, onChange }: { value: NonNullable<Action['if']>; choices: Choices | null; onChange: (v: NonNullable<Action['if']>) => void }) {
  return (
    <div className="card card-body mb-3 card-if">
      <h3 className="mb-1">Only when (IF)</h3>
      <p className="small text-body-secondary">
        Optional. When the action is tapped, these are checked first. If they don't hold, nothing runs and the app (or this page) says what wasn't true, e.g.
        "Not run: Roof window is Open".
      </p>
      {value.conditions.length > 1 && (
        <select className="form-select form-select-sm mb-2" style={{ width: 'auto' }} aria-label="Combine conditions" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as 'all' | 'any' })}>
          <option value="all">All of these are true</option>
          <option value="any">Any of these is true</option>
        </select>
      )}
      {choices &&
        value.conditions.map((c, i) => (
          <Item key={i} onRemove={() => onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) })}>
            <ConditionEditor condition={c} choices={choices} onChange={(n) => onChange({ ...value, conditions: value.conditions.map((x, j) => (j === i ? n : x)) })} />
          </Item>
        ))}
      {choices && (
        <button className="btn btn-outline-secondary btn-sm align-self-start" onClick={() => onChange({ ...value, conditions: [...value.conditions, defaultCondition(choices)] })}>
          Add condition
        </button>
      )}
    </div>
  );
}
