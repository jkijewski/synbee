import type { FastifyInstance, FastifyReply } from 'fastify';
import { GroupError } from '../groups.js';
import { CommandError } from '../ports.js';
import { flattenExposes } from '../exposes.js';
import { isLight, lightSummary, summaryWords } from '../features/light-summary.js';
import { idParam, type RouteContext } from './context.js';

// Light groups: create, plan, members and commands.
export function registerGroupRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { groups, control } = ctx;
  // What the group's lights show: "Off", the one look they share, or how many are on (0008).
  const groupLight = (members: Array<{ ieee: string }>): string | null => {
    if (!control || members.length === 0) return null;
    const words = members.map((m) => {
      const z = control.knownDevices().find((x) => x.ieee_address.toLowerCase() === m.ieee.toLowerCase());
      const props = flattenExposes(z?.definition?.exposes);
      return isLight(props) ? summaryWords(lightSummary(props, control.deviceState(m.ieee.toLowerCase()) ?? {}, control.lightMode(m.ieee))) : '';
    });
    if (words.some((w) => w === '')) return null;
    if (words.every((w) => w === words[0])) return words[0]!;
    const on = words.filter((w) => w !== 'Off').length;
    return on === 0 ? 'Off' : `${on} of ${words.length} on`;
  };
  const groupReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GroupError || err instanceof CommandError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  app.get('/api/groups', async () => groups.list().map((g) => ({ ...g, light: groupLight(g.members) })));
  app.post<{ Body: { name?: unknown; members?: unknown } }>('/api/groups', async (req, reply) => groupReply(reply, () => groups.create(req.body ?? {})));
  // Creates a planned group, such as one imported from Tuya, in Zigbee2MQTT once its devices have moved.
  app.post<{ Params: { id: string }; Body: { members?: unknown } }>('/api/groups/:id/create', async (req, reply) =>
    groupReply(reply, () => groups.create({ id: idParam(req.params.id), members: req.body?.members })),
  );
  app.put<{ Params: { id: string }; Body: { members?: unknown } }>('/api/groups/:id/members', async (req, reply) =>
    groupReply(reply, async () => {
      await groups.setMembers(idParam(req.params.id), req.body?.members);
      return { ok: true };
    }),
  );
  app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req, reply) =>
    groupReply(reply, async () => {
      await groups.remove(idParam(req.params.id));
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: unknown }>('/api/groups/:id/command', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Send an object of property values' });
    return groupReply(reply, async () => {
      await groups.command(idParam(req.params.id), body as Record<string, unknown>);
      return { ok: true };
    });
  });
}
