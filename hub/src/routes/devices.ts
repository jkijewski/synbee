import type { FastifyInstance, FastifyReply } from 'fastify';
import { saveDeviceSettings } from '../device-settings.js';
import { DeviceError } from '../devices.js';
import { flattenExposes } from '../exposes.js';
import { buttonEvents } from '../buttons.js';
import { RoomError } from '../rooms.js';
import { CommandError } from '../ports.js';
import { attentionList } from '../attention.js';
import { confirmationFor } from '../features/index.js';
import { isLight, lightSummary } from '../features/light-summary.js';
import type { RouteContext } from './context.js';

// Devices: the list, one device with its capabilities and state, renaming, labels, commands and removal.
export function registerDeviceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, control, devices, rooms, history, energy, iconOf, labelsOf, engine, rules, groups } = ctx;
  // Timer steps counting down that will set this device, directly or through a light group (0010).
  const timersOf = (ieee: string) =>
    engine
      .timers()
      .filter((t) => (t.action.type === 'device' ? t.action.device === ieee : groups.list().some((g) => g.id === (t.action as { group: number }).group && g.members.some((m) => m.ieee === ieee))))
      .map((t) => ({ ruleId: t.ruleId, rule: rules.get(t.ruleId)?.name ?? `rule ${t.ruleId}`, step: t.step, dueAt: t.dueAt, what: engine.describeStep(t.action) }));
  const deviceReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DeviceError || err instanceof RoomError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };

  // A light's look in a few words (0008), or null for other devices and lights without a known state.
  const lightOf = (ieee: string) => {
    const z = control?.knownDevices().find((x) => x.ieee_address.toLowerCase() === ieee);
    const props = flattenExposes(z?.definition?.exposes);
    if (!control || !isLight(props)) return null;
    return lightSummary(props, control.deviceState(ieee) ?? {}, control.lightMode(ieee));
  };

  app.get('/api/devices', async () =>
    devices.list().map((d) => ({ ...d, alsoRooms: rooms.alsoRooms(d.ieee), online: control?.isOnline(d.ieee) ?? null, labels: labelsOf(d.ieee), ...iconOf(d.ieee), light: lightOf(d.ieee) })),
  );

  app.get<{ Params: { ieee: string } }>('/api/devices/:ieee', async (req, reply) => {
    const ieee = req.params.ieee.toLowerCase();
    const row = devices.get(ieee);
    if (!row) return reply.code(404).send({ error: 'Unknown device' });
    const z = control?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee);
    return {
      ...row,
      recognised: Boolean(z?.definition),
      supported: z?.supported ?? null,
      model: z?.definition?.model ?? z?.model_id ?? null,
      vendor: z?.definition?.vendor ?? z?.manufacturer ?? null,
      properties: flattenExposes(z?.definition?.exposes),
      events: buttonEvents(z?.definition?.model, z?.definition?.exposes),
      state: control?.deviceState(ieee) ?? {},
      online: control?.isOnline(ieee) ?? null,
      labels: labelsOf(ieee),
      ...iconOf(ieee),
      alsoRooms: rooms.alsoRooms(ieee),
      raw: z && !z.definition ? { modelId: z.model_id ?? null, manufacturer: z.manufacturer ?? null, interviewCompleted: z.interview_completed ?? null } : null,
      light: lightOf(ieee),
      timers: timersOf(ieee),
    };
  });

  // Names for the channels of a multi-channel switch, such as spot, LED and regał. An empty label removes it.
  app.put<{ Params: { ieee: string }; Body: unknown }>('/api/devices/:ieee/labels', async (req, reply) =>
    deviceReply(reply, () => devices.setLabels(req.params.ieee, req.body)),
  );

  // Unlocking and similar commands need ?confirmed=1, after the owner answered the feature's question (0008).
  app.post<{ Params: { ieee: string }; Querystring: { confirmed?: string }; Body: unknown }>('/api/devices/:ieee/command', async (req, reply) => {
    if (!control) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Send an object of property values' });
    const z = control.knownDevices().find((d) => d.ieee_address.toLowerCase() === req.params.ieee.toLowerCase());
    const question = confirmationFor(flattenExposes(z?.definition?.exposes), body as Record<string, unknown>);
    if (question && req.query.confirmed !== '1') return reply.code(409).send({ ok: false, error: question, confirm: question });
    try {
      return { ok: true, state: await control.command(req.params.ieee, body as Record<string, unknown>) };
    } catch (err) {
      if (err instanceof CommandError) return reply.code(err.status).send({ ok: false, error: err.message });
      throw err;
    }
  });

  // Asks the device for its current values, for devices that report only changes (Zigbee2MQTT's "get").
  app.post<{ Params: { ieee: string } }>('/api/devices/:ieee/refresh', async (req, reply) => {
    if (!control) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
    const z = control.knownDevices().find((d) => d.ieee_address.toLowerCase() === req.params.ieee.toLowerCase());
    const gettable = flattenExposes(z?.definition?.exposes).filter((p) => p.gettable).map((p) => p.property);
    try {
      return { ok: true, state: await control.refresh(req.params.ieee, gettable) };
    } catch (err) {
      if (err instanceof CommandError) return reply.code(err.status).send({ ok: false, error: err.message });
      throw err;
    }
  });

  // Asks Zigbee2MQTT to read a joined device's details again, for devices whose interview didn't finish.
  app.post<{ Params: { ieee: string } }>('/api/devices/:ieee/interview', async (req, reply) => {
    if (!control) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
    try {
      await control.interview(req.params.ieee);
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  // Sets up a device's reporting again, for example after the gateway was replaced (0007).
  app.post<{ Params: { ieee: string } }>('/api/devices/:ieee/configure', async (req, reply) => {
    if (!control) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
    try {
      await control.configure(req.params.ieee);
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  // Alarms and warnings across all devices: leaks, smoke, low batteries, offline devices (0008).
  app.get('/api/attention', async () => attentionList(devices, control, ctx.deps.gatewayWeb?.status()));

  app.patch<{ Params: { ieee: string }; Body: { name?: unknown; room?: unknown; icon?: unknown } }>('/api/devices/:ieee', async (req, reply) =>
    deviceReply(reply, async () => {
      const ieee = req.params.ieee.toLowerCase();
      const { before, renamed } = saveDeviceSettings(db, ieee, req.body ?? {});
      let warning: string | undefined;
      // Keep Zigbee2MQTT's name in step, so its topics match what the owner sees.
      if (renamed && before.status === 'joined' && control?.connected()) {
        try {
          await control.rename(ieee, renamed);
        } catch (err) {
          warning = `Saved, but Zigbee2MQTT kept its old name: ${(err as Error).message}`;
        }
      }
      return { ok: true, ...(warning ? { warning } : {}) };
    }),
  );

  // Forgets a device. One that has joined is asked to leave the Zigbee network (Zigbee2MQTT's normal removal, not
  // "force"), so it starts looking for a network again. Actions and rules that used it are kept and flagged.
  app.delete<{ Params: { ieee: string } }>('/api/devices/:ieee', async (req, reply) => {
    const ieee = req.params.ieee.toLowerCase();
    const row = devices.get(ieee);
    if (!row) return reply.code(404).send({ error: 'Unknown device' });
    if (row.status === 'joined' && control?.knownDevices().some((d) => d.ieee_address.toLowerCase() === ieee)) {
      if (!control.connected()) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected, so the device could not be told to leave' });
      try {
        await control.leave(ieee);
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }
    devices.remove(ieee);
    history.forget(ieee);
    energy.forget(ieee);
    return { ok: true };
  });
}
