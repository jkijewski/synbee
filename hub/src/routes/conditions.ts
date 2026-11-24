import type { FastifyInstance, FastifyReply } from 'fastify';
import { CheckError, Checks } from '../checks.js';
import { parseIf, RuleError } from '../rules.js';
import { SensorGroupError, SensorGroups } from '../sensor-groups.js';
import { DeviceTiles } from '../tiles.js';
import { setTemperatureUnit, temperatureUnit } from '../units.js';
import { idParam, type RouteContext } from './context.js';

// Sensor groups and checks (plan: checks and alerts): manage them, and read their state now.
export function registerConditionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const sensorGroups = ctx.deps.sensorGroups ?? new SensorGroups(ctx.db, ctx.control);
  const checks = ctx.deps.checks ?? new Checks(ctx.db);
  const engine = ctx.engine;
  const reply400 = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SensorGroupError || err instanceof CheckError || err instanceof RuleError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  {
    app.get('/api/sensor-groups', async () => sensorGroups.list().map((g) => ({ ...g, status: sensorGroups.status(g.id) })));
    app.post('/api/sensor-groups', async (req, reply) => reply400(reply, () => sensorGroups.create(req.body)));
    app.put<{ Params: { id: string } }>('/api/sensor-groups/:id', async (req, reply) => reply400(reply, () => sensorGroups.update(idParam(req.params.id), req.body)));
    app.delete<{ Params: { id: string } }>('/api/sensor-groups/:id', async (req, reply) =>
      reply400(reply, () => {
        sensorGroups.remove(idParam(req.params.id));
        return { ok: true };
      }),
    );
  }
  {
    // The IF is parsed by the rules' own parser, so checks accept the same conditions as automations.
    const withIf = (body: unknown) => (body && typeof body === 'object' ? { ...(body as Record<string, unknown>), if: parseIf((body as Record<string, unknown>).if) } : body);
    app.get('/api/checks', async () => checks.list().map((c) => ({ ...c, now: engine?.evaluateCheck(c.id) ? { ...engine.evaluateCheck(c.id)!, check: undefined } : null })));
    app.post('/api/checks', async (req, reply) => reply400(reply, () => checks.create(withIf(req.body))));
    app.put<{ Params: { id: string } }>('/api/checks/:id', async (req, reply) => reply400(reply, () => checks.update(idParam(req.params.id), withIf(req.body))));
    app.delete<{ Params: { id: string } }>('/api/checks/:id', async (req, reply) =>
      reply400(reply, () => {
        checks.remove(idParam(req.params.id));
        return { ok: true };
      }),
    );
  }

  // Which devices show as status tiles in the app, and which reading.
  const tiles = ctx.deps.deviceTiles ?? new DeviceTiles(ctx.db);
  app.get('/api/device-tiles', async () => tiles.list());
  app.put<{ Params: { ieee: string }; Body: { on?: unknown; property?: unknown; labels?: { active?: unknown; inactive?: unknown } } }>('/api/devices/:ieee/tile', async (req, reply) => {
    if (!ctx.devices.get(req.params.ieee.toLowerCase())) return reply.code(404).send({ error: 'Unknown device' });
    const property = typeof req.body?.property === 'string' && req.body.property ? req.body.property : null;
    try {
      return { tile: tiles.set(req.params.ieee, req.body?.on === true, property, req.body?.labels ?? {}) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // The temperature unit for the app, tiles and notification texts.
  app.get('/api/units', async () => ({ temperature: temperatureUnit(ctx.db) }));
  app.put<{ Body: { temperature?: unknown } }>('/api/units', async (req, reply) => {
    try {
      return { temperature: setTemperatureUnit(ctx.db, req.body?.temperature) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
