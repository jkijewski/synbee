import { useApi } from '../useApi';

// The gateway's connection in the header, on every page: green when Zigbee2MQTT is running and talking to the
// gateway, red when not (devices can then neither be switched nor heard). Refreshed every 10 seconds; opens the
// Gateway page.
export function GatewayLight() {
  const { data, error } = useApi<{ gateway?: { online: boolean; address: string | null; gateways?: Array<{ id: number; name: string; online: boolean }> } }>('/api/status', {
    refreshMs: 10000,
  });
  const online = !error && data?.gateway?.online === true;
  const known = Boolean(data) || Boolean(error);
  // With several gateways (0023): green only when all are connected; the tooltip names the ones that aren't.
  const all = data?.gateway?.gateways ?? [];
  const down = all.filter((g) => !g.online).map((g) => g.name);
  const several = all.length > 1;
  const label = !known
    ? 'Gateway: checking…'
    : online
      ? several
        ? `All ${all.length} gateways connected`
        : 'Gateway connected'
      : several && down.length
        ? `Not connected: ${down.join(', ')}`
        : 'Gateway not connected';
  return (
    <a
      href="#gateway"
      className={`btn btn-sm me-2 d-inline-flex align-items-center gap-1 ${!known ? 'btn-outline-secondary' : online ? 'btn-outline-success' : 'btn-danger'}`}
      title={`${label}${!several && data?.gateway?.address ? ` (${data.gateway.address})` : ''}`}
      aria-label={label}
    >
      <span className="icon" aria-hidden="true">
        {online ? 'router' : 'portable_wifi_off'}
      </span>
      <span className="d-none d-md-inline">{online ? (several ? 'Gateways' : 'Gateway') : known ? (several && down.length < all.length ? `${down.length} of ${all.length} offline` : 'Gateway offline') : 'Gateway'}</span>
    </a>
  );
}
