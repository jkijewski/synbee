import type { FastifyInstance } from 'fastify';
import type { HistoryRange } from '../history.js';
import type { RouteContext } from './context.js';

// Reading history and energy totals (0014): series for a device's graphs, kWh per day and month, and the retention.
export function registerHistoryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { history, energy, devices } = ctx;
  const RANGES: HistoryRange[] = ['24h', '7d', '30d', '1y'];

  app.get<{ Params: { ieee: string }; Querystring: { property?: string; range?: string } }>('/api/devices/:ieee/history', async (req, reply) => {
    const ieee = req.params.ieee.toLowerCase();
    const range = (req.query.range ?? '24h') as HistoryRange;
    if (!RANGES.includes(range)) return reply.code(400).send({ error: 'range must be 24h, 7d, 30d or 1y' });
    if (!req.query.property) return { properties: history.properties(ieee) };
    return { property: req.query.property, range, points: history.series(ieee, req.query.property, range) };
  });

  app.get<{ Querystring: { ieee?: string } }>('/api/energy', async (req) => {
    if (req.query.ieee) return energy.totals(req.query.ieee.toLowerCase());
    const names = devices.names();
    return {
      ...energy.totals(),
      devices: energy.devices().map((ieee) => ({ ieee, name: names.get(ieee) ?? ieee, ...energy.totals(ieee) })),
    };
  });

  app.get('/api/history/settings', async () => history.settings());
  app.put('/api/history/settings', async (req, reply) => {
    try {
      return history.saveSettings(req.body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
