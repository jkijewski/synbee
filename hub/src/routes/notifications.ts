import type { FastifyInstance } from 'fastify';
import { idParam, type RouteContext } from './context.js';

// The hub's notification inbox (0014): the bell's unread count, the list, marking read, and auto-alarm settings.
export function registerNotificationRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { notifications } = ctx;
  app.get('/api/notifications', async () => notifications.list());
  app.get('/api/notifications/unread', async () => notifications.unread());
  app.post<{ Params: { id: string } }>('/api/notifications/:id/read', async (req, reply) =>
    notifications.markRead(idParam(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'Unknown notification' }),
  );
  app.post('/api/notifications/read-all', async () => {
    notifications.markAllRead();
    return { ok: true };
  });
  app.get('/api/notifications/settings', async () => notifications.settings());
  app.put('/api/notifications/settings', async (req) => notifications.saveSettings(req.body));
}
