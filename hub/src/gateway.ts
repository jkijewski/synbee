import fs from 'node:fs';
import path from 'node:path';
import makeMdns from 'multicast-dns';
import { networkSuffix } from './networks.js';
import type { ZigbeeBridge } from './zigbee.js';

// The Gateway page (0007): the Zigbee coordinator's settings, finding it on the network, and the network map.
// SynBee never updates the coordinator's firmware; the owner does that in the coordinator's own web page.

export const ADAPTERS = ['ember', 'zstack', 'deconz', 'zigate', 'zboss'] as const;
export type Adapter = (typeof ADAPTERS)[number];
export const DEFAULT_CHANNEL = 25;
/** The first gateway's channel is 25; further gateways start on 20, so two networks don't share one. */
export const defaultChannel = (network: number) => (network === 1 ? DEFAULT_CHANNEL : 20);

export interface GatewaySettings {
  adapter: Adapter;
  rtscts: boolean;
  channel: number;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Service types network Zigbee coordinators announce over mDNS (SMLIGHT, and generic and other makers' names). */
export const MDNS_SERVICES = ['_slzb-06._tcp.local', '_zigbee-coordinator._tcp.local', '_zigstar_gw._tcp.local', '_uzg-01._tcp.local', '_xzg._tcp.local'];

export interface FoundCoordinator {
  name: string;
  host: string;
  address: string; // host:port, ready to use
  service: string;
}

/** Asks the local network who offers a Zigbee coordinator, for a few seconds. Never connects to one. */
export async function discoverCoordinators(options: { timeoutMs?: number; mdns?: Parameters<typeof makeMdns>[0] } = {}): Promise<FoundCoordinator[]> {
  const mdns = makeMdns(options.mdns);
  const services = new Map<string, { name: string; service: string; target?: string; port?: number }>();
  const addresses = new Map<string, string>();
  mdns.on('response', (res) => {
    for (const rec of [...res.answers, ...res.additionals]) {
      if (rec.type === 'PTR' && MDNS_SERVICES.includes(rec.name)) {
        const instance = String(rec.data);
        if (!services.has(instance)) services.set(instance, { name: instance.replace(`.${rec.name}`, ''), service: rec.name });
      } else if (rec.type === 'SRV') {
        const known = services.get(rec.name) ?? { name: rec.name.split('.')[0]!, service: MDNS_SERVICES.find((s) => rec.name.endsWith(s)) ?? '' };
        if (!known.service) continue;
        const data = rec.data as { target: string; port: number };
        services.set(rec.name, { ...known, target: data.target, port: data.port });
      } else if (rec.type === 'A') {
        addresses.set(rec.name, String(rec.data));
      }
    }
  });
  mdns.query({ questions: MDNS_SERVICES.map((name) => ({ name, type: 'PTR' as const })) });
  await new Promise((r) => setTimeout(r, options.timeoutMs ?? 3000));
  await new Promise<void>((resolve) => mdns.destroy(() => resolve()));
  const found: FoundCoordinator[] = [];
  for (const s of services.values()) {
    if (!s.target || !s.port) continue;
    const host = addresses.get(s.target) ?? s.target.replace(/\.$/, '');
    found.push({ name: s.name, host, address: `${host}:${s.port}`, service: s.service });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export class Gateway {
  constructor(
    private readonly secretsDir: string,
    private readonly zigbee?: ZigbeeBridge,
    /** Which gateway (0023). A new one defaults to channel 20, away from the first one's 25. */
    private readonly network = 1,
  ) {}

  private get file(): string {
    return path.join(this.secretsDir, `gateway${networkSuffix(this.network)}.json`);
  }

  settings(): GatewaySettings {
    let saved: Partial<GatewaySettings> = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<GatewaySettings>;
    } catch {
      // Defaults: SLZB-06MU with EmberZNet.
    }
    return {
      adapter: ADAPTERS.includes(saved.adapter as Adapter) ? (saved.adapter as Adapter) : 'ember',
      rtscts: saved.rtscts === true,
      channel: Number.isInteger(saved.channel) && saved.channel! >= 11 && saved.channel! <= 26 ? saved.channel! : defaultChannel(this.network),
    };
  }

  /** Saves adapter type and flow control, and the channel only with the re-pairing warning confirmed. */
  save(input: { adapter?: unknown; rtscts?: unknown; channel?: unknown; confirmChannelChange?: unknown }): { settings: GatewaySettings; channelChanged: boolean } {
    const current = this.settings();
    const next = { ...current };
    if (input.adapter !== undefined) {
      if (!ADAPTERS.includes(input.adapter as Adapter)) throw new GatewayError(`Adapter must be one of ${ADAPTERS.join(', ')}`);
      next.adapter = input.adapter as Adapter;
    }
    if (input.rtscts !== undefined) {
      if (typeof input.rtscts !== 'boolean') throw new GatewayError('Flow control is on or off');
      next.rtscts = input.rtscts;
    }
    if (input.channel !== undefined && input.channel !== current.channel) {
      if (!Number.isInteger(input.channel) || (input.channel as number) < 11 || (input.channel as number) > 26) throw new GatewayError('The Zigbee channel is 11 to 26');
      if (input.confirmChannelChange !== true) throw new GatewayError('Changing the channel can mean pairing every device again. Confirm it to go ahead.', 409);
      next.channel = input.channel as number;
    }
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify(next), { mode: 0o600 });
    return { settings: next, channelChanged: next.channel !== current.channel };
  }

  /** Zigbee2MQTT's scan of the network: which device hears which, with link quality. Takes a while on big networks. */
  async networkMap(): Promise<{ nodes: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> }> {
    if (!this.zigbee?.connected()) throw new GatewayError('Zigbee2MQTT is not connected', 503);
    const data = await this.zigbee.request('networkmap', { type: 'raw', routes: false }, 180_000);
    const value = (data.value ?? {}) as { nodes?: unknown[]; links?: unknown[] };
    const nodes = (value.nodes ?? []).map((n) => {
      const x = n as Record<string, unknown>;
      return { ieee: String(x.ieeeAddr ?? '').toLowerCase(), name: x.friendlyName, type: x.type, lastSeen: x.lastSeen ?? null };
    });
    const links = (value.links ?? []).map((l) => {
      const x = l as { source?: { ieeeAddr?: string }; target?: { ieeeAddr?: string }; lqi?: number; linkquality?: number; relationship?: number; depth?: number };
      return {
        source: String(x.source?.ieeeAddr ?? '').toLowerCase(),
        target: String(x.target?.ieeeAddr ?? '').toLowerCase(),
        lqi: x.lqi ?? x.linkquality ?? null,
        relationship: x.relationship ?? null,
        depth: x.depth ?? null,
      };
    });
    return { nodes, links };
  }
}
