import { api, type ApiError } from '../api';
import { ItemLink } from '../Related';
import { useApi } from '../useApi';
import { useState } from 'react';

// The notification inbox (0014): newest first, with links to the device or rule, marked read when opened.
interface Notification {
  id: number;
  at: number;
  level: 'info' | 'warning' | 'alarm';
  title: string;
  body: string;
  ieee: string | null;
  ruleId: number | null;
  repeats: number;
  read: boolean;
}

const BADGE = { info: 'text-bg-secondary', warning: 'text-bg-warning', alarm: 'text-bg-danger' } as const;
const LEVEL = { info: 'Info', warning: 'Warning', alarm: 'Alarm' } as const;

export function NotificationsPage() {
  const list = useApi<Notification[]>('/api/notifications', { refreshMs: 15000 });
  const settings = useApi<{ autoAlarms: boolean }>('/api/notifications/settings');
  const [error, setError] = useState('');
  const run = (p: Promise<unknown>, after: () => void) => void p.then(after, (e: ApiError) => setError(e.message));
  const unread = (list.data ?? []).filter((n) => !n.read).length;
  return (
    <>
    <div className="card card-body mb-3">
      <div className="line">
        <h2 style={{ marginRight: 'auto' }}>Notifications</h2>
        <button className="btn btn-outline-secondary btn-sm" disabled={unread === 0} onClick={() => run(api('POST', '/api/notifications/read-all'), list.reload)}>
          Mark all read
        </button>
      </div>
      {(error || list.error) && <p className="text-danger">{error || list.error}</p>}
      {list.data?.length === 0 && <p className="muted">Nothing yet. Rules can send notifications with a Notify step, and leaks, smoke and gas alarms notify by themselves.</p>}
      <ul className="list-group mb-3">
        {list.data?.map((n) => (
          <li key={n.id} className={`list-group-item d-flex gap-2 align-items-start${n.read ? '' : ' fw-semibold'}`}>
            <span className={`badge ${BADGE[n.level]} mt-1`}>{LEVEL[n.level]}</span>
            <div style={{ flex: 1 }}>
              <div>
                {n.title}
                {n.repeats > 0 && <span className="muted small"> (×{n.repeats + 1})</span>}
              </div>
              {n.body && <div className="small">{n.body}</div>}
              <div className="small muted fw-normal">
                {new Date(n.at).toLocaleString()}
                {n.ieee && (
                  <>
                    {' · '}
                    <ItemLink kind="device" id={n.ieee}>
                      device
                    </ItemLink>
                  </>
                )}
                {n.ruleId !== null && (
                  <>
                    {' · '}
                    <ItemLink kind="rule" id={n.ruleId}>
                      automation
                    </ItemLink>
                  </>
                )}
              </div>
            </div>
            {!n.read && (
              <button className="btn btn-outline-secondary btn-sm" onClick={() => run(api('POST', `/api/notifications/${n.id}/read`), list.reload)}>
                Read
              </button>
            )}
          </li>
        ))}
      </ul>
      {settings.data && (
        <label className="d-flex align-items-center gap-2">
          <input
            className="form-check-input mt-0"
            type="checkbox"
            checked={settings.data.autoAlarms}
            onChange={(e) => run(api('PUT', '/api/notifications/settings', { autoAlarms: e.target.checked }), settings.reload)}
          />
          Notify by itself when a leak, smoke, carbon monoxide or gas alarm starts
        </label>
      )}
    </div>
    <ChatCard />
    </>
  );
}

interface ChatView {
  configured: boolean;
  address: string | null;
  minLevel: 'info' | 'warning' | 'alarm';
}

/** Alerts out of the hub: a Synology Chat channel's incoming webhook, which the Chat app pushes to the phone. */
function ChatCard() {
  const view = useApi<ChatView>('/api/notifications/chat');
  const pause = useApi<{ paused: { until: number; by: string } | null }>('/api/alerts/pause', { refreshMs: 30000 });
  const [url, setUrl] = useState('');
  const [level, setLevel] = useState<ChatView['minLevel'] | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const minLevel = level || view.data?.minLevel || 'warning';
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
      setNote(done);
      view.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  };
  if (view.error) return null;
  return (
    <div className="card card-body mb-3">
      {pause.data?.paused && (
        <div className="alert alert-warning py-2 small line">
          <span style={{ marginRight: 'auto' }}>
            Alerts are paused by {pause.data.paused.by} until {new Date(pause.data.paused.until).toLocaleString()}. Nothing is sent to Chat meanwhile; the bell keeps
            everything.
          </span>
          <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => void act(() => api('DELETE', '/api/alerts/pause').then(pause.reload), 'Alerts resumed.')}>
            Resume now
          </button>
        </div>
      )}
      <h3 className="line mb-1">
        Send alerts to Synology Chat
        <span className={`badge rounded-pill ${view.data?.configured ? 'text-bg-success' : 'text-bg-light border'}`}>{view.data?.configured ? 'on' : 'off'}</span>
      </h3>
      <p className="small text-body-secondary">
        SynBee posts notifications to a channel in Synology Chat, and the Chat app on your phone shows them at once. Everything stays between SynBee and your
        NAS's Chat server.
      </p>
      <details className="small mb-3">
        <summary>How to set it up</summary>
        <ol className="mt-2 mb-0">
          <li>Install <strong>Synology Chat Server</strong> from Package Center, and the <strong>Synology Chat</strong> app on your phone.</li>
          <li>In Chat, create a channel, e.g. "Home alerts" (or use your own conversation).</li>
          <li>Open your profile picture → <strong>Integration → Incoming Webhooks → Create</strong>, choose the channel, and copy the <strong>Webhook URL</strong>.</li>
          <li>Paste it below and press <strong>Save</strong>, then <strong>Send a test</strong>.</li>
        </ol>
      </details>
      {view.data?.configured && (
        <p className="small mb-2">
          Posting to <code>{view.data.address}</code> (the token is kept privately on the NAS).
        </p>
      )}
      <div className="row g-2 align-items-end">
        <div className="col-md-7">
          <label className="form-label small mb-1" htmlFor="chat-url">
            {view.data?.configured ? 'New webhook URL (optional)' : 'Webhook URL'}
          </label>
          <input
            id="chat-url"
            className="form-control form-control-sm"
            autoComplete="off"
            placeholder="https://…/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1" htmlFor="chat-level">
            Send
          </label>
          <select id="chat-level" className="form-select form-select-sm" value={minLevel} onChange={(e) => setLevel(e.target.value as ChatView['minLevel'])}>
            <option value="alarm">alarms only</option>
            <option value="warning">warnings and alarms</option>
            <option value="info">everything</option>
          </select>
        </div>
        <div className="col-md-2">
          <button
            className="btn btn-primary btn-sm w-100"
            disabled={busy || (!url.trim() && !view.data?.configured)}
            onClick={() => void act(() => api('PUT', '/api/notifications/chat', { url: url.trim() || undefined, minLevel }).then(() => setUrl('')), 'Saved.')}
          >
            Save
          </button>
        </div>
      </div>
      {view.data?.configured && (
        <div className="d-flex flex-wrap gap-2 mt-2">
          <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => void act(() => api('POST', '/api/notifications/chat/test'), 'Test message sent. Check Synology Chat.')}>
            Send a test
          </button>
          <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => void act(() => api('DELETE', '/api/notifications/chat'), 'Removed.')}>
            Remove
          </button>
        </div>
      )}
      {note && <p className="small text-success mt-2 mb-0">{note}</p>}
      {error && <p className="small text-danger mt-2 mb-0">{error}</p>}
    </div>
  );
}
