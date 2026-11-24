import fs from 'node:fs';
import path from 'node:path';

// The gateways (Zigbee networks) the hub has (0023), in networks.json in the private folder: an id and a name each.
// The supervisor reads the same file to run one Zigbee2MQTT per gateway. Gateway 1 always exists; its files keep the
// names they always had (coordinator, gateway.json, zigbee2mqtt/), and gateway n adds "-n" (supervisor/z2m.mjs).

export const MAX_NETWORKS = 9;

export interface Network {
  id: number;
  name: string;
}

export class NetworkError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const networkSuffix = (id: number) => (id === 1 ? '' : `-${id}`);
export const networkTopic = (id: number) => `zigbee2mqtt${networkSuffix(id)}`;

const cleanName = (raw: unknown): string => {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 40) throw new NetworkError('Name must be 1 to 40 characters');
  return name;
};

export class Networks {
  constructor(private readonly secretsDir: string) {}

  private get file(): string {
    return path.join(this.secretsDir, 'networks.json');
  }

  list(): Network[] {
    let saved: unknown = [];
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // Only the first gateway so far.
    }
    const valid = (Array.isArray(saved) ? saved : []).filter(
      (n): n is Network => !!n && Number.isInteger(n.id) && n.id >= 1 && n.id <= MAX_NETWORKS && typeof n.name === 'string',
    );
    const byId = new Map(valid.map((n) => [n.id, { id: n.id, name: n.name }]));
    if (!byId.has(1)) byId.set(1, { id: 1, name: 'Gateway 1' });
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): Network | null {
    return this.list().find((n) => n.id === id) ?? null;
  }

  private save(list: Network[]): void {
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  }

  add(input: { name?: unknown }): Network {
    const list = this.list();
    const name = cleanName(input.name);
    if (list.some((n) => n.name.toLowerCase() === name.toLowerCase())) throw new NetworkError(`There is already a gateway called ${name}`, 409);
    const id = [...Array(MAX_NETWORKS).keys()].map((i) => i + 1).find((i) => !list.some((n) => n.id === i));
    if (!id) throw new NetworkError(`At most ${MAX_NETWORKS} gateways`, 409);
    const network = { id, name };
    this.save([...list, network]);
    return network;
  }

  rename(id: number, input: { name?: unknown }): Network {
    const list = this.list();
    if (!list.some((n) => n.id === id)) throw new NetworkError('Unknown gateway', 404);
    const name = cleanName(input.name);
    if (list.some((n) => n.id !== id && n.name.toLowerCase() === name.toLowerCase())) throw new NetworkError(`There is already a gateway called ${name}`, 409);
    this.save(list.map((n) => (n.id === id ? { ...n, name } : n)));
    return { id, name };
  }

  /** Removes a gateway from the hub; its Zigbee2MQTT stops, and its data and backup stay in the private folder. */
  remove(id: number): void {
    if (id === 1) throw new NetworkError('The first gateway can be replaced, not removed', 409);
    const list = this.list();
    if (!list.some((n) => n.id === id)) throw new NetworkError('Unknown gateway', 404);
    this.save(list.filter((n) => n.id !== id));
  }
}
