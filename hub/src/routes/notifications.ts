import type { FastifyInstance, FastifyReply } from 'fastify';
import { ChatError, chatText } from '../chat-channel.js';
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

  // Alerts out of the hub through Synology Chat: the webhook (kept privately, shown without its token), the lowest
  // level that is posted, and a test message.
  // Alerts paused from the app: who and until when, and resuming them here.
  const pause = ctx.deps.alertPause;
  app.get('/api/alerts/pause', async () => ({ paused: pause?.current() ?? null }));
  app.delete('/api/alerts/pause', async () => {
    pause?.set(0, 'owner');
    return { paused: null };
  });
  const chat = ctx.deps.chat;
  const chatReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    if (!chat) return reply.code(404).send({ error: 'Not available on this hub' });
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ChatError) return reply.code(err.status).send({ error: err.message });
      console.warn(`hub: Synology Chat: ${(err as Error).message}`);
      return reply.code(502).send({ error: `Synology Chat can't be reached: ${(err as Error).message}` });
    }
  };
  app.get('/api/notifications/chat', async (_req, reply) => chatReply(reply, () => chat!.view()));
  app.put<{ Body: { url?: unknown; minLevel?: unknown } }>('/api/notifications/chat', async (req, reply) =>
    chatReply(reply, () => chat!.save(req.body ?? {})),
  );
  app.delete('/api/notifications/chat', async (_req, reply) =>
    chatReply(reply, () => {
      chat!.clear();
      return chat!.view();
    }),
  );
  app.post('/api/notifications/chat/test', async (_req, reply) =>
    chatReply(reply, async () => {
      await chat!.send(chatText({ level: 'info', title: 'Test message from SynBee', body: 'Alerts from your automations will arrive here.' }));
      return { ok: true };
    }),
  );
}
