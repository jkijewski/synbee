import type { FastifyInstance, FastifyReply } from 'fastify';
import { MemberError } from '../members.js';
import { APP_ACCESS_KEY, defaultAppAccess, Settings, validateAppAccess, type AppAccess } from '../settings.js';
import { idParam, type RouteContext } from './context.js';

// App members (0020): managed only here, behind the owner's sign-in on the home network.
function accessKind(raw: string): 'action' | 'room' {
  if (raw !== 'action' && raw !== 'room') throw new MemberError('Use action or room', 404);
  return raw;
}

export function registerMemberRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { members } = ctx;
  const appListener = ctx.deps.appListener;
  const memberReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };

  // The app away from home (0021): off until the owner sets the outside address and port and switches it on.
  const settings = new Settings(ctx.db);
  const access = () => settings.get<AppAccess>(APP_ACCESS_KEY, defaultAppAccess);
  app.get('/api/app-access', async () => ({ ...access(), appPort: appListener?.port ?? null }));
  app.put('/api/app-access', async (req, reply) => {
    try {
      const value = validateAppAccess(req.body);
      settings.set(APP_ACCESS_KEY, value);
      console.log(`hub: app access from outside ${value.outside ? `on, at ${value.address}:${value.port ?? appListener?.port}` : 'off'}`);
      return { ...value, appPort: appListener?.port ?? null };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/members', async () => ({
    members: members.list(),
    app: appListener ? { port: appListener.port, addresses: appListener.addresses(), fingerprint: appListener.fingerprint() } : null,
  }));
  app.post<{ Body: { name?: unknown } }>('/api/members', async (req, reply) => memberReply(reply, () => members.create(req.body ?? {})));
  app.put<{ Params: { id: string }; Body: { name?: unknown } }>('/api/members/:id', async (req, reply) =>
    memberReply(reply, () => members.rename(idParam(req.params.id), req.body ?? {})),
  );
  app.delete<{ Params: { id: string } }>('/api/members/:id', async (req, reply) =>
    memberReply(reply, () => {
      members.remove(idParam(req.params.id));
      return { ok: true };
    }),
  );
  app.put<{ Params: { id: string }; Body: { revokedActions?: unknown; revokedRooms?: unknown; devicesWithoutRoom?: unknown } }>(
    '/api/members/:id/permissions',
    async (req, reply) => memberReply(reply, () => members.setPermissions(idParam(req.params.id), req.body ?? {})),
  );
  // The QR code the phone scans: the hub's addresses, its key fingerprint and a one-time code. Shown only here.
  // Who sees a status tile in the app (sensor groups, checks, device tiles): everyone until the owner hides it.
  app.get<{ Params: { tile: string } }>('/api/tile-access/:tile', async (req, reply) => memberReply(reply, () => members.tileAccess(req.params.tile)));
  app.put<{ Params: { tile: string }; Body: { allowed?: unknown } }>('/api/tile-access/:tile', async (req, reply) =>
    memberReply(reply, () => members.setTileAccess(req.params.tile, req.body?.allowed)),
  );
  app.put<{ Params: { id: string }; Body: { allowed?: unknown } }>('/api/members/:id/pause-alerts', async (req, reply) =>
    memberReply(reply, () => members.setMayPauseAlerts(idParam(req.params.id), req.body?.allowed)),
  );
  app.post<{ Params: { id: string } }>('/api/members/:id/pairing-code', async (req, reply) =>
    memberReply(reply, () => {
      if (!appListener) throw new MemberError('The app listener is not running on this hub', 409);
      const addresses = appListener.addresses().map((a) => `${a}:${appListener.port}`);
      if (addresses.length === 0) throw new MemberError('This NAS has no home network address for the app', 409);
      const { code, expiresAt } = members.createPairingCode(idParam(req.params.id));
      const fingerprint = appListener.fingerprint();
      // The outside address goes along, so the phone works away from home without typing it.
      const a = access();
      const outside = a.outside && a.address ? [`${a.address}:${a.port ?? appListener.port}`] : [];
      return {
        code,
        expiresAt,
        addresses,
        outside,
        fingerprint,
        qr: JSON.stringify({ v: 1, hub: 'synbee', a: addresses, ...(outside.length ? { o: outside } : {}), fp: fingerprint, c: code }),
      };
    }),
  );
  // Who may use one action or room, for that item's own page.
  app.get<{ Params: { kind: string; id: string } }>('/api/member-access/:kind/:id', async (req, reply) =>
    memberReply(reply, () => members.access(accessKind(req.params.kind), idParam(req.params.id))),
  );
  app.put<{ Params: { kind: string; id: string }; Body: { allowed?: unknown } }>('/api/member-access/:kind/:id', async (req, reply) =>
    memberReply(reply, () => members.setAccess(accessKind(req.params.kind), idParam(req.params.id), req.body?.allowed)),
  );
  app.put<{ Params: { id: string; phone: string }; Body: { outside?: unknown } }>('/api/members/:id/phones/:phone', async (req, reply) =>
    memberReply(reply, () => members.setPhoneOutside(idParam(req.params.id), req.params.phone, req.body?.outside)),
  );
  app.delete<{ Params: { id: string; phone: string } }>('/api/members/:id/phones/:phone', async (req, reply) =>
    memberReply(reply, () => {
      members.revokePhone(idParam(req.params.id), req.params.phone);
      return { ok: true };
    }),
  );
}
