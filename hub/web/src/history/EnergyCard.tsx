import { useApi } from '../useApi';

// Energy used (0014): today, this month and a bar per day for the last month, from the device's kWh counter.
interface Totals {
  today: number;
  month: number;
  days: Array<{ day: string; kwh: number }>;
}

const kwh = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)} kWh`;

export function EnergyCard({ ieee }: { ieee: string }) {
  const { data } = useApi<Totals>(`/api/energy?ieee=${ieee}`, { refreshMs: 60000 });
  if (!data) return null;
  return (
    <div className="card card-body mb-3">
      <h3>Energy</h3>
      <EnergyBars totals={data} />
    </div>
  );
}

export function EnergyBars({ totals }: { totals: Totals }) {
  const max = Math.max(0.001, ...totals.days.map((d) => d.kwh));
  return (
    <>
      <p className="mb-2">
        Today <strong>{kwh(totals.today)}</strong> · this month <strong>{kwh(totals.month)}</strong>
      </p>
      {totals.days.length === 0 ? (
        <p className="muted small">Counting starts with the device's next energy reports.</p>
      ) : (
        <div className="energy-bars" role="img" aria-label="Energy per day for the last 31 days">
          {totals.days.map((d) => (
            <div key={d.day} className="energy-bar" style={{ height: `${Math.max(2, (d.kwh / max) * 100)}%` }} title={`${d.day}: ${kwh(d.kwh)}`} />
          ))}
        </div>
      )}
    </>
  );
}
