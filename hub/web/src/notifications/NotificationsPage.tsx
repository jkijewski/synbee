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
  );
}
