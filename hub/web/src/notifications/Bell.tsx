import { useApi } from '../useApi';

// The bell in the header (0014): unread notifications, red when one of them is an alarm. Refreshed every 15 seconds.
export function Bell({ onOpen }: { onOpen: () => void }) {
  const { data } = useApi<{ count: number; alarm: boolean }>('/api/notifications/unread', { refreshMs: 15000 });
  const count = data?.count ?? 0;
  return (
    <button className="btn btn-outline-secondary btn-sm position-relative me-2" onClick={onOpen} aria-label={`Notifications, ${count} unread`} title="Notifications">
      <span className="icon" aria-hidden="true">
        notifications
      </span>
      {count > 0 && (
        <span className={`position-absolute top-0 start-100 translate-middle badge rounded-pill ${data?.alarm ? 'text-bg-danger' : 'text-bg-primary'}`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
