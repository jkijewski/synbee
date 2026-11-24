import { useState } from 'react';
import { api, ApiError, type Rule } from '../api';
import { ItemLink, useHashId } from '../Related';
import { ItemRooms, RoomSections, useRooms } from '../RoomSections';
import { blank, OUTCOME, when } from './common';
import { History } from './RuleHistory';
import { RuleEditor } from './RuleEditor';
import { useApi } from '../useApi';

// The "Automations" page: WHEN / IF / THEN rules as a single column of cards (0010).
export function Rules() {
  const { data: rules, error: loadError, reload: load } = useApi<Rule[]>('/api/rules');
  const [newRule, setNewRule] = useState<Rule | null>(null);
  const [openId, setOpenId] = useHashId();
  const { rooms: roomList, membership } = useRooms(rules);
  const [history, setHistory] = useState<Rule | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);


  const toggle = async (r: Rule) => {
    setMessage(null);
    try {
      await api('POST', `/api/rules/${r.id}/enabled`, { enabled: !r.enabled });
      load();
    } catch (err) {
      setMessage({ text: (err as ApiError).message, error: true });
    }
  };
  const remove = async (r: Rule) => {
    if (!confirm(`Delete the rule "${r.name}" and its history?`)) return;
    await api('DELETE', `/api/rules/${r.id}`).catch((e: ApiError) => setMessage({ text: e.message, error: true }));
    load();
  };

  const opened = openId !== null ? rules?.find((r) => String(r.id) === openId) : undefined;
  if (newRule) return <RuleEditor initial={newRule} onDone={() => (setNewRule(null), load())} />;
  if (opened) return <RuleEditor key={opened.id} initial={opened} onDone={() => (setOpenId(null), load())} />;
  if (history) return <History rule={history} onBack={() => (setHistory(null), load())} />;
  return (
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Automations</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setNewRule(blank())}>
          New rule
        </button>
      </div>
      <p className="muted">Each rule: WHEN something happens, IF conditions hold, THEN run its steps in order.</p>
      {loadError && <p className="text-danger">{loadError}</p>}
      {message && <p className={message.error ? 'text-danger' : 'text-success'}>{message.text}</p>}
      {rules && rules.length === 0 && <p className="muted">No rules yet.</p>}
      <RoomSections
        items={rules ?? []}
        rooms={roomList}
        className="list"
        roomsOf={(r) => membership?.rules[String(r.id)] ?? []}
        render={(r, inRooms) => (
          <div className="card" key={r.id}>
            <div className="line">
              <label className="switch" title={r.enabled ? 'Enabled' : 'Disabled'}>
                <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} aria-label={`Enable ${r.name}`} />
                <span />
              </label>
              <strong style={{ marginRight: 'auto' }}>
                <ItemLink kind="rule" id={r.id!}>
                  {r.name}
                </ItemLink>
              </strong>
              <ItemRooms ids={inRooms} rooms={roomList} />
              {r.draft && <span className="badge rounded-pill text-bg-warning">draft from Tuya</span>}
              {r.running && <span className="badge rounded-pill text-bg-light border">running</span>}
            </div>
            {r.warnings?.map((w, i) => (
              <span key={i} className="text-danger small">
                {w}
              </span>
            ))}
            {r.readiness && !r.readiness.ready && <span className="muted small">Waiting for: {r.readiness.missing.join(', ')}</span>}
            {r.draft && r.readiness?.ready && <span className="text-success small">Ready to enable: all its devices have moved.</span>}
            {(r.waiting ?? []).map((w) => (
              <p key={w.slot} className="small text-info-emphasis mb-1">
                Waiting: runs at {new Date(w.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} if nothing changes before then.
              </p>
            ))}
            {(r.timers ?? []).map((t) => (
              <p key={`t${t.step}`} className="small text-info-emphasis mb-1">
                Timer: {t.what.replace(/^After \d+ min \(restarts if run again\): /, '')} at{' '}
                {new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            ))}
            {r.lastRun && (
              <span className="muted small">
                Last run {when(r.lastRun.startedAt)}: <span className={`outcome ${r.lastRun.outcome}`}>{OUTCOME[r.lastRun.outcome]}</span>
                {r.lastRun.reason && ` — ${r.lastRun.reason}`}
              </span>
            )}
            <div className="line">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setOpenId(r.id!)}>Edit</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setHistory(r)}>History</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => void remove(r)}>Delete</button>
            </div>
          </div>
        )}
      />
    </div>
  );
}

