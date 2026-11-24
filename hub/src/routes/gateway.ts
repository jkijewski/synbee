import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthError } from '../auth.js';
import { BackupError, sameIeee } from '../backup.js';
import { CoordinatorError } from '../coordinator.js';
import { discoverCoordinators, GatewayError } from '../gateway.js';
import { tailLog } from '../logs.js';
import { MAX_PAIRING_MINUTES, MAX_PAIRING_SECONDS } from '../zigbee.js';
import fs from 'node:fs';
import { LATEST_SCHEMA, migrationLog, schemaVersion, snapshots } from '../db.js';
import { NetworkError } from '../networks.js';
import { GatewayHardening } from '../gateway-hardening.js';
import { readSecurity, setSecurity, SlzbClient, SlzbError, type SecurityChange } from '../slzb.js';
import { localAddressTowards } from '../network.js';
import { Settings } from '../settings.js';
import type { NetworkRuntime, RouteContext } from './context.js';

// The gateway (0007): coordinator status and settings, backup and restore (0007), replacement, pairing and logs.
export function registerGatewayRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { version, deps, auth } = ctx;
  // Which gateway a request is about (0023): ?network=n, the first by default.
  const pick = (req: { query?: unknown }): NetworkRuntime => {
    const raw = (req.query as { network?: string } | undefined)?.network;
    const id = raw === undefined ? 1 : Number(raw);
    const n = ctx.networks().find((x) => x.id === id);
    if (!n) throw new GatewayError('Unknown gateway', 404);
    return n;
  };
  const networkReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GatewayError || err instanceof NetworkError || err instanceof CoordinatorError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  // One gateway's status, for the list and its page.
  const summary = (n: NetworkRuntime) => {
    const info = n.zigbee?.bridgeInfo() ?? null;
    const address = n.coordinator?.address() ?? '';
    return {
      id: n.id,
      name: n.name,
      address,
      webPage: address ? `http://${address.split(':')[0]}` : null,
      connected: Boolean(n.zigbee?.gatewayOnline() && info),
      zigbee2mqtt: { bundled: deps.z2mVersion || null, running: info?.version ?? null },
      coordinator: info?.coordinator ?? null,
      network: info?.network ?? null,
      adapterInUse: info?.adapter ?? null,
      devices: n.zigbee?.knownDevices().length ?? 0,
      backup: n.backup ? n.backup.status() : null,
      settings: n.gateway?.settings() ?? null,
      web: n.id === 1 ? (deps.gatewayWeb?.status() ?? null) : null,
    };
  };
  app.get('/api/gateways', async () => ctx.networks().map(summary));
  // "Harden gateway security": the owner's confirmations of the gateway's own protections, per gateway.
  const hardening = new GatewayHardening(new Settings(ctx.db));
  app.get('/api/gateway/hardening', async (req, reply) => networkReply(reply, () => hardening.get(pick(req).id)));
  // Option B: SynBee reads and sets the gateway's protections with the owner's gateway login.
  const slzbReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      // Logged without any login: what failed, for the Status page's log.
      console.warn(`hub: gateway settings: ${(err as Error).message}${(err as { cause?: { code?: string } }).cause?.code ? ` (${(err as { cause: { code: string } }).cause.code})` : ''}`);
      if (err instanceof SlzbError || err instanceof GatewayError) return reply.code(err.status).send({ error: err.message });
      if (err instanceof Error && /fetch failed|ECONNREFUSED|EHOSTUNREACH|timeout|abort/i.test(err.message + String((err as { cause?: unknown }).cause ?? ''))) {
        return reply.code(502).send({ error: "The gateway's web page doesn't answer (switched off while SynBee is connected, or unreachable)" });
      }
      throw err;
    }
  };
  const slzbFor = (n: NetworkRuntime, login = deps.gatewayLogins?.get(n.id) ?? null) => {
    const host = (n.coordinator?.address() ?? '').split(':')[0];
    if (!host) throw new GatewayError('This gateway has no address yet', 409);
    return { host, client: new SlzbClient(host, login, deps.slzbFetch) };
  };
  app.get('/api/gateway/slzb', async (req, reply) =>
    slzbReply(reply, async () => {
      const n = pick(req);
      const login = deps.gatewayLogins?.get(n.id) ?? null;
      if (!login) return { loginSaved: false, security: null };
      try {
        return { loginSaved: true, user: login.user, security: await readSecurity(slzbFor(n, login).client) };
      } catch (err) {
        // The owner switched the gateway's web page off while SynBee is connected: it then hides its settings from
        // SynBee too. That is the state they chose, not an error; the page says how to change it.
        const hidden = err instanceof SlzbError ? err.status === 409 : err instanceof Error && !(err instanceof GatewayError);
        if (hidden && hardening.get(n.id).webOffWhileConnected) return { loginSaved: true, user: login.user, security: null, webOff: true };
        throw err;
      }
    }),
  );
  app.put<{ Body: { user?: unknown; password?: unknown } }>('/api/gateway/slzb/login', async (req, reply) =>
    slzbReply(reply, async () => {
      const n = pick(req);
      if (!deps.gatewayLogins) throw new GatewayError('Not available on this hub', 404);
      const user = typeof req.body?.user === 'string' ? req.body.user.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!user || !password || user.length > 64 || password.length > 128) throw new GatewayError("Enter the gateway's web login: user and password");
      // Checked before it is kept: only a login the gateway accepts is saved.
      const security = await readSecurity(slzbFor(n, { user, password }).client);
      deps.gatewayLogins.set(n.id, { user, password });
      console.log(`hub: login for gateway ${n.id}'s web page saved`);
      return { loginSaved: true, user, security };
    }),
  );
  app.delete('/api/gateway/slzb/login', async (req, reply) =>
    slzbReply(reply, () => {
      deps.gatewayLogins?.clear(pick(req).id);
      return { loginSaved: false };
    }),
  );
  app.post<{ Body: { step?: unknown; on?: unknown; password?: unknown; untestedOk?: unknown } }>('/api/gateway/slzb/set', async (req, reply) =>
    slzbReply(reply, async () => {
      const n = pick(req);
      const { host, client } = slzbFor(n);
      const before = await readSecurity(client);
      if (!before.tested && req.body?.untestedOk !== true) {
        throw new GatewayError(`SynBee hasn't been tested with this gateway's firmware (build ${before.build ?? 'unknown'}). Confirm to go ahead, or set it on the gateway's own page.`, 409);
      }
      const step = req.body?.step;
      let change: SecurityChange;
      let nasIp: string | null = null;
      if (step === 'whitelist') {
        // The address the gateway sees this NAS connect from, not a guess: a wrong one would cut SynBee off the radio.
        nasIp = req.body?.on === false ? null : await localAddressTowards(host);
        change = { step: 'whitelist', ip: nasIp };
      } else if (step === 'apPassword') {
        change = { step: 'apPassword', password: req.body?.on === false ? null : typeof req.body?.password === 'string' ? req.body.password : '' };
      } else if (step === 'webOffWhileConnected') {
        change = { step: 'webOffWhileConnected', on: req.body?.on !== false };
      } else if (step === 'mqttOff') {
        change = { step: 'mqttOff' };
      } else {
        throw new GatewayError('Unknown step');
      }
      const { needReboot } = await setSecurity(client, change);
      // Remembered, because once on the gateway no longer shows its settings to SynBee.
      if (change.step === 'webOffWhileConnected') hardening.set(n.id, 'webOffWhileConnected', change.on);
      console.log(`hub: gateway ${n.id}: ${String(step)} set${nasIp ? ` (allowed IP ${nasIp})` : ''}${needReboot ? '; the gateway restarts' : ''}`);
      if (step === 'whitelist' && nasIp) {
        // A safety net: if SynBee can't reach the radio two minutes later, the whitelist is switched off again.
        setTimeout(() => {
          if (n.zigbee?.gatewayOnline() === true) return;
          void setSecurity(client, { step: 'whitelist', ip: null }).then(
            () => {
              console.warn(`hub: gateway ${n.id} unreachable after the socket whitelist; it was switched off again`);
              ctx.notifications.notify({
                level: 'warning',
                title: `Gateway "${n.name}": socket whitelist undone`,
                body: `SynBee couldn't reach the radio after allowing only ${nasIp}, so it switched the whitelist off again. Check the gateway's Security page.`,
                dedupeKey: `whitelist-undone-${n.id}`,
              });
            },
            () => undefined,
          );
        }, 120_000).unref?.();
      }
      // Read back, so the page shows what the gateway really has now. A restart can make it briefly unreachable.
      let after = null;
      try {
        after = await readSecurity(client);
      } catch {
        // Restarting; the page reads it again shortly.
      }
      return { ok: true, needReboot, nasIp, security: after };
    }),
  );
  app.put<{ Body: { step?: unknown; done?: unknown } }>('/api/gateway/hardening', async (req, reply) =>
    networkReply(reply, () => {
      const n = pick(req);
      try {
        return hardening.set(n.id, req.body?.step, req.body?.done);
      } catch (err) {
        throw new GatewayError((err as Error).message);
      }
    }),
  );
  app.post<{ Body: { name?: unknown } }>('/api/gateways', async (req, reply) =>
    networkReply(reply, () => {
      if (!deps.networkAdmin) throw new GatewayError('Not available on this hub', 404);
      return deps.networkAdmin.add(req.body ?? {});
    }),
  );
  app.put<{ Params: { id: string }; Body: { name?: unknown } }>('/api/gateways/:id', async (req, reply) =>
    networkReply(reply, () => {
      if (!deps.networkAdmin) throw new GatewayError('Not available on this hub', 404);
      return deps.networkAdmin.rename(Number(req.params.id), req.body ?? {});
    }),
  );
  app.delete<{ Params: { id: string } }>('/api/gateways/:id', async (req, reply) =>
    networkReply(reply, () => {
      if (!deps.networkAdmin) throw new GatewayError('Not available on this hub', 404);
      deps.networkAdmin.remove(Number(req.params.id));
      return { ok: true };
    }),
  );
  // Coordinator backup and replacement (0007). Admin only, home network only: the public listener has none of this.
  const backupReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BackupError || err instanceof CoordinatorError || err instanceof AuthError || err instanceof GatewayError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  app.get('/api/backup', async (req, reply) =>
    networkReply(reply, () => {
      const n = pick(req);
      return n.backup ? n.backup.status() : reply.code(404).send({ error: 'No coordinator backup on this hub' });
    }),
  );
  app.post<{ Body: { password?: unknown; passphrase?: unknown; understood?: unknown } }>('/api/backup/download', async (req, reply) =>
    backupReply(reply, () => {
      const n = pick(req);
      if (!n.backup) throw new BackupError('No coordinator backup on this hub', 404);
      if (req.body?.understood !== true) throw new BackupError('Confirm that you understand the file holds the key to your Zigbee network');
      auth.confirmPassword(typeof req.body?.password === 'string' ? req.body.password : '', req.socket.remoteAddress ?? '');
      const { filename, data } = n.backup.download(req.body?.passphrase as string);
      console.log(`hub: coordinator backup of gateway ${n.id} downloaded from ${req.socket.remoteAddress ?? 'unknown'}`);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      return reply.send(data);
    }),
  );
  // Restores a downloaded backup into Zigbee2MQTT's data and restarts it: on a fresh install or with a new coordinator.
  app.post<{ Body: { archive?: unknown; passphrase?: unknown; password?: unknown } }>('/api/backup/restore', { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) =>
    backupReply(reply, () => {
      const n = pick(req);
      if (!n.backup || !n.coordinator) throw new BackupError('No coordinator backup on this hub', 404);
      auth.confirmPassword(typeof req.body?.password === 'string' ? req.body.password : '', req.socket.remoteAddress ?? '');
      if (typeof req.body?.archive !== 'string' || typeof req.body?.passphrase !== 'string') throw new BackupError('Choose the backup file and enter its passphrase');
      const staged = n.backup.stageRestore(Buffer.from(req.body.archive, 'base64'), req.body.passphrase);
      console.log(`hub: a downloaded coordinator backup was staged for restore on gateway ${n.id}`);
      return { ok: true, ...staged, restarting: n.coordinator.restart() };
    }),
  );
  // The Gateway page: the coordinator's status, settings, network map and finding it on the network (0007).
  const gatewayReply = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GatewayError || err instanceof CoordinatorError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
  app.get('/api/gateway', async (req, reply) => networkReply(reply, () => summary(pick(req))));
  // Checks the coordinator's web page for a login now, e.g. after the owner turned it on.
  app.post('/api/gateway/web-check', async (_req, reply) => (deps.gatewayWeb ? deps.gatewayWeb.check() : reply.code(404).send({ error: 'No gateway check on this hub' })));
  app.put<{ Body: { adapter?: unknown; rtscts?: unknown; channel?: unknown; confirmChannelChange?: unknown } }>('/api/gateway/settings', async (req, reply) =>
    gatewayReply(reply, () => {
      const n = pick(req);
      if (!n.gateway || !n.coordinator) throw new GatewayError('Not available on this hub', 404);
      const saved = n.gateway.save(req.body ?? {});
      if (saved.channelChanged) console.log(`hub: Zigbee channel of gateway ${n.id} changed to ${saved.settings.channel}`);
      return { ...saved, restarted: n.coordinator.restart() };
    }),
  );
  app.post('/api/gateway/restart', async (req, reply) =>
    gatewayReply(reply, () => {
      const n = pick(req);
      if (!n.coordinator) throw new GatewayError('Not available on this hub', 404);
      return { restarted: n.coordinator.restart() };
    }),
  );
  app.post('/api/gateway/networkmap', async (req, reply) =>
    gatewayReply(reply, async () => {
      const n = pick(req);
      if (!n.gateway) throw new GatewayError('Not available on this hub', 404);
      try {
        return await n.gateway.networkMap();
      } catch (err) {
        if (err instanceof GatewayError) throw err;
        throw new GatewayError((err as Error).message, 502);
      }
    }),
  );
  app.get('/api/gateway/discover', async () => ({ found: await (deps.discover ?? discoverCoordinators)() }));

  app.get('/api/coordinator', async (req, reply) =>
    networkReply(reply, () => {
    const n = pick(req);
    const info = n.zigbee?.bridgeInfo() ?? null;
    const backupIeee = n.backup?.backupIeee() ?? null;
    const currentIeee = info?.coordinator.ieee ?? null;
    return {
      address: n.coordinator?.address() ?? '',
      connected: n.zigbee?.connected() ?? false,
      info,
      backupIeee,
      // Whether the coordinator in use carries the network's original IEEE address, as copied by a restore.
      sameIeee: backupIeee && currentIeee ? sameIeee(backupIeee, currentIeee) : null,
    };
    }),
  );
  app.post<{ Body: { address?: unknown } }>('/api/coordinator/address', async (req, reply) =>
    backupReply(reply, () => {
      const n = pick(req);
      if (!n.coordinator) throw new CoordinatorError('Not available on this hub', 404);
      const result = n.coordinator.setFirst(req.body ?? {});
      hardening.reset(n.id);
      console.log(`hub: gateway ${n.id} set to ${result.address}`);
      return result;
    }),
  );
  app.post<{ Body: { address?: unknown; oldDisconnected?: unknown; sameChipFamily?: unknown } }>('/api/coordinator/replace', async (req, reply) =>
    backupReply(reply, () => {
      const n = pick(req);
      if (!n.coordinator) throw new CoordinatorError('Not available on this hub', 404);
      const result = n.coordinator.replace(req.body ?? {});
      hardening.reset(n.id);
      console.log(`hub: coordinator address of gateway ${n.id} changed to ${result.address}`);
      return result;
    }),
  );
  // Asks a device to set up its reporting again, for devices that went quiet after a coordinator replacement.
  app.get<{ Params: { name: string } }>('/api/logs/:name', async (req, reply) => {
    const lines = tailLog(deps.logDir, req.params.name);
    return lines ? { lines } : reply.code(404).send({ error: 'Unknown log' });
  });

  // Hub and Zigbee2MQTT status for the status page. Never includes the network key or Zigbee2MQTT's configuration.
  app.get('/api/status', async () => {
    const first = ctx.networks()[0];
    const all = ctx.networks();
    // Upgrades and the copies taken before them (database and Zigbee2MQTT), for going back if one went wrong.
    let z2mSnapshots: string[] = [];
    try {
      z2mSnapshots = deps.snapshotDir ? fs.readdirSync(deps.snapshotDir).sort().reverse() : [];
    } catch {
      // None yet.
    }
    return {
      version,
      database: {
        version: schemaVersion(ctx.db),
        latest: LATEST_SCHEMA,
        upgrades: migrationLog(ctx.db),
        snapshots: deps.dbFile ? snapshots(deps.dbFile) : [],
        zigbee2mqttSnapshots: z2mSnapshots,
      },
      zigbee2mqtt: {
        bundled: deps.z2mVersion || null,
        connected: first?.zigbee?.connected() ?? false,
        info: first?.zigbee?.bridgeInfo() ?? null,
      },
      // For the header's gateway light: every gateway's link, through Zigbee2MQTT. Online only when all are.
      gateway: {
        online: all.length > 0 && all.every((n) => n.zigbee?.gatewayOnline() === true),
        address: first?.coordinator?.address() ?? null,
        gateways: all.map((n) => ({ id: n.id, name: n.name, online: n.zigbee?.gatewayOnline() ?? false })),
      },
    };
  });

  // Adding devices (0023): one gateway at a time, chosen with ?network=n.
  app.get('/api/pairing', async (req, reply) =>
    networkReply(reply, () => {
      const zigbee = pick(req).zigbee;
      if (!zigbee) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
      return zigbee.pairingState();
    }),
  );

  // Devices new ones can join through (routers), on every gateway, for choosing where a device joins.
  app.get('/api/pairing/routers', async () =>
    ctx.networks().flatMap((n) =>
      (n.zigbee?.routers() ?? []).map((d) => {
        const ieee = d.ieee_address.toLowerCase();
        const row = ctx.devices.get(ieee);
        return { ieee, name: row?.name ?? d.friendly_name, network: n.id, online: n.zigbee?.isOnline(ieee) ?? null };
      }),
    ),
  );

  app.post<{ Body: { seconds?: unknown; minutes?: unknown; through?: unknown } }>('/api/pairing', async (req, reply) => {
    let zigbee;
    // Joining through a chosen device: the gateway is the one that device is on.
    const through = typeof req.body?.through === 'string' && /^0x[0-9a-f]{16}$/i.test(req.body.through) ? req.body.through.toLowerCase() : null;
    try {
      zigbee = through ? ctx.networks().find((n) => n.zigbee?.knownDevices().some((d) => d.ieee_address.toLowerCase() === through))?.zigbee : pick(req).zigbee;
      if (through && !zigbee) return reply.code(404).send({ error: 'That device is not on any connected gateway' });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    if (!zigbee) return reply.code(503).send({ error: 'Zigbee2MQTT is not connected' });
    const minutes = req.body?.minutes;
    if (minutes !== undefined) {
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PAIRING_MINUTES) {
        return reply.code(400).send({ error: `minutes must be 1 to ${MAX_PAIRING_MINUTES}` });
      }
      try {
        return await zigbee.openPairingMinutes(minutes, through);
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }
    const seconds = req.body?.seconds ?? 120;
    if (seconds === 0) {
      await zigbee.closePairing();
      return zigbee.pairingState();
    }
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_PAIRING_SECONDS) {
      return reply.code(400).send({ error: `seconds must be 0 to ${MAX_PAIRING_SECONDS}` });
    }
    try {
      return await zigbee.openPairing(seconds, through);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
