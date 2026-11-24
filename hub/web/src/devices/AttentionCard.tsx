import { ItemLink } from '../Related';
import { useApi } from '../useApi';

// What needs attention now (0008): leaks, smoke and gas first, then low batteries, tampering and offline devices.
// Shown at the top of the Devices page only when there is something; refreshed every 15 seconds.

interface AttentionItem {
  ieee: string;
  name: string;
  level: 'alarm' | 'warning';
  what: string;
}

export function AttentionCard() {
  const { data } = useApi<AttentionItem[]>('/api/attention', { refreshMs: 15000 });
  if (!data || data.length === 0) return null;
  const alarm = data.some((i) => i.level === 'alarm');
  return (
    <div className={`alert ${alarm ? 'alert-danger' : 'alert-warning'} mb-3`} role={alarm ? 'alert' : 'status'}>
      <strong>Needs attention</strong>
      <ul className="mb-0 mt-1">
        {data.map((i) => (
          <li key={`${i.ieee}/${i.what}`}>
            <span className={`badge me-2 ${i.level === 'alarm' ? 'text-bg-danger' : 'text-bg-warning'}`}>{i.level === 'alarm' ? 'Alarm' : 'Warning'}</span>
            {i.ieee ? (
              <ItemLink kind="device" id={i.ieee}>
                {i.name}
              </ItemLink>
            ) : (
              <a href="#gateway">{i.name}</a>
            )}
            : {i.what}
          </li>
        ))}
      </ul>
    </div>
  );
}
