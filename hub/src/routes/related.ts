import type { FastifyInstance } from 'fastify';
import { idParam, type RouteContext } from './context.js';

// Related items and "used by" warnings, from one dependency index (0013).
export function registerRelatedRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { dependencyIndex } = ctx;
  const KINDS = ['device', 'group', 'action', 'rule'] as const;
  const relatedId = (kind: string, raw: string) => (kind === 'device' ? raw.toLowerCase() : idParam(raw));
  app.get<{ Params: { kind: string; id: string } }>('/api/related/:kind/:id', async (req, reply) => {
    const kind = req.params.kind as (typeof KINDS)[number];
    if (!KINDS.includes(kind)) return reply.code(404).send({ error: 'Unknown kind' });
    return dependencyIndex().related(kind, relatedId(kind, req.params.id));
  });
  app.get<{ Params: { kind: string; id: string } }>('/api/used-by/:kind/:id', async (req, reply) => {
    const kind = req.params.kind as 'device' | 'group' | 'action';
    if (!['device', 'group', 'action'].includes(kind)) return reply.code(404).send({ error: 'Unknown kind' });
    return dependencyIndex().usedBy(kind, relatedId(kind, req.params.id));
  });
}
