import type { FastifyInstance, FastifyReply } from 'fastify';
import { Checks } from '../checks.js';
import { SensorGroups } from '../sensor-groups.js';
import { buttonEvents } from '../buttons.js';
import { supportsFade } from '../device-kinds.js';
import { LOCATION_KEY, Settings } from '../settings.js';
import { sunTime, validLocation } from '../sun.js';
import { flattenExposes } from '../exposes.js';
import { RuleError } from '../rules.js';
import { idParam, type RouteContext } from './context.js';

// Automations as WHEN / IF / THEN rules (0010), their runs, and the choices the rule editor offers.
export function registerRuleRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { control, devices, groups, actions, rules, engine, iconOf, labelsOf } = ctx;
  const settings = new Settings(ctx.db);
  const ruleReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RuleError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  const withRunInfo = <T extends { id: number }>(r: T) => ({
    ...r,
    running: engine.isRunning(r.id),
    lastRun: engine.history(r.id, 1)[0] ?? null,
    waiting: engine.armed(r.id),
    timers: engine.timers(r.id).map((t) => ({ step: t.step, dueAt: t.dueAt, what: engine.describeStep(t.action) })),
  });
  app.get('/api/rules', async () => rules.list().map(withRunInfo));
  app.post('/api/rules', async (req, reply) => ruleReply(reply, () => rules.create(req.body)));
  app.get<{ Params: { id: string } }>('/api/rules/:id', async (req, reply) => {
    const rule = rules.get(idParam(req.params.id));
    return rule ? withRunInfo(rules.view(rule)) : reply.code(404).send({ error: 'Unknown rule' });
  });
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (req, reply) => ruleReply(reply, () => rules.update(idParam(req.params.id), req.body)));
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req, reply) =>
    ruleReply(reply, () => {
      rules.remove(idParam(req.params.id));
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: { enabled?: unknown } }>('/api/rules/:id/enabled', async (req, reply) =>
    ruleReply(reply, () => rules.setEnabled(idParam(req.params.id), req.body?.enabled === true)),
  );
  app.post<{ Params: { id: string }; Body: { force?: unknown } }>('/api/rules/:id/test', async (req, reply) =>
    ruleReply(reply, () => engine.test(idParam(req.params.id), req.body?.force === true)),
  );
  app.get<{ Params: { id: string } }>('/api/rules/:id/runs', async (req, reply) => {
    const id = idParam(req.params.id);
    if (!rules.get(id)) return reply.code(404).send({ error: 'Unknown rule' });
    return engine.history(id);
  });
  // Everything the rule editor offers in its dropdowns, built from the devices' capabilities (0008).
  // A timer step counting down can be stopped without running it.
  app.delete<{ Params: { id: string; step: string } }>('/api/rules/:id/timers/:step', async (req) => {
    engine.cancelTimer(idParam(req.params.id), idParam(req.params.step));
    return { ok: true };
  });

  // The home's location, for sunrise and sunset (0010), and today's sun times there.
  app.get('/api/location', async () => {
    const location = engine.location();
    const today = new Date();
    return {
      location,
      sunrise: location ? (sunTime('sunrise', today, location)?.toISOString() ?? null) : null,
      sunset: location ? (sunTime('sunset', today, location)?.toISOString() ?? null) : null,
    };
  });
  app.put<{ Body: unknown }>('/api/location', async (req, reply) => {
    if (req.body === null || (req.body && typeof req.body === 'object' && (req.body as Record<string, unknown>).location === null)) {
      settings.set(LOCATION_KEY, null);
      return { ok: true, location: null };
    }
    const location = validLocation(req.body);
    if (!location) return reply.code(400).send({ error: 'Give latitude (−90 to 90) and longitude (−180 to 180) as numbers' });
    settings.set(LOCATION_KEY, location);
    return { ok: true, location };
  });

  app.get('/api/rule-choices', async () => {
    return {
      devices: devices.list().map((d) => {
        const z = control?.knownDevices().find((x) => x.ieee_address.toLowerCase() === d.ieee);
        return {
          ieee: d.ieee,
          name: d.name,
          status: d.status,
          room: d.room,
          icon: iconOf(d.ieee).icon,
          labels: labelsOf(d.ieee),
          events: buttonEvents(z?.definition?.model, z?.definition?.exposes),
          properties: flattenExposes(z?.definition?.exposes),
          // Whether a fade can go with its light settings (Zigbee2MQTT's transition option); unknown devices: yes.
          fades: z ? supportsFade(z) : true,
        };
      }),
      groups: groups.list().map((g) => ({
        id: g.id,
        name: g.name,
        created: g.created,
        properties: g.properties,
        fades: g.members.every((m) => {
          const z = control?.knownDevices().find((x) => x.ieee_address.toLowerCase() === m.ieee);
          return !z || supportsFade(z);
        }),
      })),
      actions: actions.list().map((a) => ({ id: a.id, name: a.name })),
      sensorGroups: (() => {
        const sg = new SensorGroups(ctx.db, control);
        return sg.list().map((g) => ({ id: g.id, name: g.name, words: sg.words(g) }));
      })(),
      checks: new Checks(ctx.db).list().map((c) => ({ id: c.id, name: c.name })),
    };
  });
}
