import type { FastifyInstance } from 'fastify';
import { AuthError, readCookie, SESSION_COOKIE, SESSION_TTL_MS } from '../auth.js';
import { countUsers, schemaVersion } from '../db.js';
import type { RouteContext } from './context.js';

// Sign-in with the owner's password, and the health check the package uses.
export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, version, auth } = ctx;
  const sessionCookie = (token: string) =>
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;

  app.get('/api/auth/state', async (req) => ({
    setupRequired: auth.setupRequired(),
    signedIn: auth.userForSession(readCookie(req.headers.cookie, SESSION_COOKIE)) !== null,
  }));

  app.post<{ Body: { password?: unknown } }>('/api/auth/setup', async (req, reply) => {
    const password = req.body?.password;
    if (typeof password !== 'string') return reply.code(400).send({ error: 'password is required' });
    try {
      auth.setOwnerPassword(password);
      const token = auth.login(password, req.socket.remoteAddress ?? '');
      reply.header('Set-Cookie', sessionCookie(token));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Body: { password?: unknown } }>('/api/auth/login', async (req, reply) => {
    const password = req.body?.password;
    if (typeof password !== 'string') return reply.code(400).send({ error: 'password is required' });
    if (auth.setupRequired()) return reply.code(409).send({ error: 'Set a password first' });
    try {
      reply.header('Set-Cookie', sessionCookie(auth.login(password, req.socket.remoteAddress ?? '')));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    auth.logout(readCookie(req.headers.cookie, SESSION_COOKIE));
    reply.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.get('/api/health', async () => ({
    ok: true,
    version,
    schema: schemaVersion(db),
    users: countUsers(db),
  }));
}
