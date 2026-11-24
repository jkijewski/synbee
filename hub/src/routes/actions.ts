import type { FastifyInstance, FastifyReply } from 'fastify';
import { ActionError } from '../actions.js';
import { idParam, type RouteContext } from './context.js';

// Actions (0011): manage and run them.
export function registerActionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { actions } = ctx;
  const actionReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ActionError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };

  app.get('/api/actions', async () => actions.list().map((a) => ({ ...a, readiness: actions.readiness(a.steps) })));
  app.post('/api/actions', async (req, reply) => actionReply(reply, () => actions.create(req.body)));
  app.get<{ Params: { id: string } }>('/api/actions/:id', async (req, reply) =>
    actions.get(idParam(req.params.id)) ?? reply.code(404).send({ error: 'Unknown action' }),
  );
  app.put<{ Params: { id: string } }>('/api/actions/:id', async (req, reply) => actionReply(reply, () => actions.update(idParam(req.params.id), req.body)));
  app.delete<{ Params: { id: string } }>('/api/actions/:id', async (req, reply) =>
    actionReply(reply, () => {
      actions.remove(idParam(req.params.id));
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string } }>('/api/actions/:id/run', async (req, reply) => actionReply(reply, () => actions.run(idParam(req.params.id))));
}
