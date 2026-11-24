import { ItemLink } from '../Related';
import { useApi } from '../useApi';
import { EnergyBars } from './EnergyCard';

// All metered devices together (0014), on the Devices page, with each device's share this month.
interface AllTotals {
  today: number;
  month: number;
  days: Array<{ day: string; kwh: number }>;
  devices: Array<{ ieee: string; name: string; today: number; month: number }>;
}

export function EnergyTotal() {
  const { data } = useApi<AllTotals>('/api/energy', { refreshMs: 60000 });
  if (!data || data.devices.length === 0) return null;
  return (
    <details className="card card-body mb-3">
      <summary>
        <strong>Energy</strong>: today {data.today.toFixed(2)} kWh, this month {data.month.toFixed(1)} kWh
      </summary>
      <div className="mt-2">
        <EnergyBars totals={data} />
        <ul className="small mt-2 mb-0">
          {[...data.devices]
            .sort((a, b) => b.month - a.month)
            .map((d) => (
              <li key={d.ieee}>
                <ItemLink kind="device" id={d.ieee}>
                  {d.name}
                </ItemLink>
                : {d.month.toFixed(2)} kWh this month
              </li>
            ))}
        </ul>
      </div>
    </details>
  );
}
