import type { FastifyInstance, FastifyReply } from 'fastify';
import { autoIcon } from '../device-icons.js';
import { GroupError } from '../groups.js';
import { PHOTO_SIZES, RoomError, type PhotoSize } from '../rooms.js';
import { idParam, type RouteContext } from './context.js';

// Rooms (0012): rooms, photos, which rooms devices are in, and room membership of actions, rules and groups.
export function registerRoomRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { control, rooms, photos, groups, dependencyIndex } = ctx;
  const roomReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RoomError || err instanceof GroupError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };

  app.get('/api/rooms', async () => rooms.list());
  app.post<{ Body: { name?: unknown; icon?: unknown } }>('/api/rooms', async (req, reply) => roomReply(reply, () => rooms.create(req.body ?? {})));
  app.put<{ Body: { order?: unknown } }>('/api/rooms/order', async (req, reply) => roomReply(reply, () => rooms.reorder(req.body?.order)));
  app.put<{ Params: { id: string }; Body: { thumb?: unknown; mobile?: unknown } }>('/api/rooms/:id/photo', { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) =>
    roomReply(reply, () => {
      if (!photos) throw new RoomError('Photos are not available on this hub', 404);
      return photos.save(idParam(req.params.id), req.body ?? {});
    }),
  );
  app.delete<{ Params: { id: string } }>('/api/rooms/:id/photo', async (req, reply) =>
    roomReply(reply, () => {
      if (!photos) throw new RoomError('Photos are not available on this hub', 404);
      photos.remove(idParam(req.params.id));
      return { ok: true };
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/api/rooms/:id/photo', async (req, reply) => {
    const size = (req.query.size ?? 'thumb') as PhotoSize;
    if (!(size in PHOTO_SIZES) || !photos) return reply.code(404).send({ error: 'No photo' });
    const photo = photos.read(idParam(req.params.id), size);
    if (!photo) return reply.code(404).send({ error: 'No photo' });
    reply.header('Content-Type', photo.type);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(photo.data);
  });
  app.patch<{ Params: { id: string }; Body: { name?: unknown; icon?: unknown; color?: unknown } }>('/api/rooms/:id', async (req, reply) =>
    roomReply(reply, () => rooms.update(idParam(req.params.id), req.body ?? {})),
  );
  app.delete<{ Params: { id: string }; Body: { moveTo?: unknown } }>('/api/rooms/:id', async (req, reply) =>
    roomReply(reply, () => {
      rooms.remove(idParam(req.params.id), req.body?.moveTo);
      return { ok: true };
    }),
  );
  // Actions and automations that use a room's devices (main or extra room), from the dependency index.
  app.get<{ Params: { id: string } }>('/api/rooms/:id/related', async (req, reply) => {
    const room = rooms.list().find((r) => r.id === idParam(req.params.id));
    if (!room) return reply.code(404).send({ error: 'Unknown room' });
    return dependencyIndex().forDevices([...room.devices, ...room.alsoDevices]);
  });
  // Which rooms each action and automation belongs to: the rooms of the devices it uses. Actions and automations
  // aren't placed in rooms themselves; their devices decide.
  app.get('/api/rooms/membership', async () => dependencyIndex().roomMembership(rooms.list()));
  // Moves several devices to one main room, or none.
  app.post<{ Body: { devices?: unknown; room?: unknown } }>('/api/rooms/move', async (req, reply) =>
    roomReply(reply, () => rooms.moveDevices(req.body?.devices, req.body?.room ?? null)),
  );
  // Adds devices to a room, keeping their main room (or making it their main room if they have none).
  app.post<{ Body: { devices?: unknown; room?: unknown } }>('/api/rooms/add', async (req, reply) =>
    roomReply(reply, () => rooms.addDevices(req.body?.devices, req.body?.room)),
  );
  app.delete<{ Params: { id: string; ieee: string } }>('/api/rooms/:id/devices/:ieee', async (req, reply) =>
    roomReply(reply, () => {
      rooms.removeFromRoom(req.params.ieee.toLowerCase(), idParam(req.params.id));
      return { ok: true };
    }),
  );
  // A device's main room, and the other rooms it is also shown in.
  app.put<{ Params: { ieee: string }; Body: { room?: unknown; also?: unknown } }>('/api/devices/:ieee/rooms', async (req, reply) =>
    roomReply(reply, () => rooms.setDeviceRooms(req.params.ieee.toLowerCase(), req.body ?? {})),
  );
  // Rooms don't switch devices; this makes a light group of the lights whose main room it is.
  app.post<{ Params: { id: string } }>('/api/rooms/:id/light-group', async (req, reply) =>
    roomReply(reply, async () => {
      const room = rooms.list().find((r) => r.id === idParam(req.params.id));
      if (!room) throw new RoomError('Unknown room', 404);
      const lights = room.devices.filter((ieee) => {
        const z = control?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee);
        return autoIcon(z?.definition) === 'lightbulb';
      });
      if (lights.length < 2) throw new RoomError('The room needs at least two lights that have joined', 409);
      return groups.create({ name: room.name, members: lights.map((ieee) => ({ ieee })) });
    }),
  );
}
