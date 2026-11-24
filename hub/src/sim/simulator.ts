import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import { sampleDevices, type SimDevice } from './sample-devices.js';

export interface Simulator {
  port: number;
  url: string;
  devices: SimDevice[];
  pressButton(friendlyName: string, action: string): Promise<void>;
  /** A device reporting values on its own, such as a sensor. */
  report(friendlyName: string, values: Record<string, unknown>): Promise<void>;
  /** Simulates a device joining; refused unless a pairing window is open. */
  joinDevice(device: SimDevice): Promise<boolean>;
  pairingOpen(): boolean;
  /** Makes a device ignore its next command, as a device that missed one message. */
  dropNext(friendlyName: string): void;
  /** Renames without publishing the new device list, to test a hub that missed it. */
  quietRenames: boolean;
  /** Makes a device stop answering commands, to test failures. */
  setOffline(friendlyName: string, offline: boolean): void;
  groups: Array<{ id: number; friendly_name: string; members: Array<{ ieee_address: string; endpoint: number }> }>;
  /** Every permit_join request received, for checking that long waits re-open joining. */
  permitJoinRequests: number[];
  /** The router named in each permit_join request ("device"), or null for the whole network. */
  permitJoinDevices: Array<string | null>;
  /** Every /set the hub sent: the device or group name and the payload, for tests. */
  sets: Array<{ name: string; payload: Record<string, unknown> }>;
  /** Number of the hub's bridge requests by command, for tests. */
  requests: Map<string, number>;
  publishDevices(devices?: SimDevice[]): Promise<void>;
  close(): Promise<void>;
}

const BASE = 'zigbee2mqtt';

// Applies a /set command like a light would: toggles, relative steps, colours and fades (reported at once here).
function applyCommand(current: Record<string, unknown>, command: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(command)) {
    if (key === 'transition') continue;
    if (key === 'brightness_step' || key === 'brightness_step_onoff') {
      const next = Math.max(0, Math.min(254, Number(current.brightness ?? 0) + Number(value)));
      current.brightness = next;
      if (key === 'brightness_step_onoff') current.state = next > 0 ? 'ON' : 'OFF';
    } else if (key === 'color_temp_step') {
      current.color_temp = Math.max(153, Math.min(500, Number(current.color_temp ?? 250) + Number(value)));
      current.color_mode = 'color_temp';
    } else if (key === 'color') {
      current.color = value;
      current.color_mode = 'xy';
    } else if (key === 'brightness' && typeof value === 'number') {
      // Real bulbs round; report one step off to exercise the tolerance.
      current.brightness = Math.min(254, value + (value % 2 === 0 ? 1 : 0));
      if (value > 0) current.state = 'ON';
    } else {
      current[key] = value === 'TOGGLE' ? (current[key] === 'ON' ? 'OFF' : 'ON') : value;
      if (key === 'color_temp') current.color_mode = 'color_temp';
    }
  }
}

// Runs an MQTT broker and a fake Zigbee2MQTT bridge on loopback, so the hub can be developed without hardware.
export async function startSimulator(options: { port?: number; devices?: SimDevice[] } = {}): Promise<Simulator> {
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;
  const url = `mqtt://127.0.0.1:${port}`;

  let devices = options.devices ?? structuredClone(sampleDevices);
  const state = new Map<string, Record<string, unknown>>();
  let permitUntil = 0;
  const offline = new Set<string>();
  const groups: Simulator['groups'] = [];
  const permitJoinRequests: number[] = [];
  const permitJoinDevices: Array<string | null> = [];
  const requests = new Map<string, number>();

  const bridge: MqttClient = await mqtt.connectAsync(url, { clientId: 'z2m-simulator' });
  const sets: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const dropping = new Set<string>();
  const publish = (topic: string, payload: unknown, retain = false) =>
    bridge.publishAsync(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain, qos: 1 });

  await publish(`${BASE}/bridge/state`, { state: 'online' }, true);
  await publish(`${BASE}/bridge/devices`, devices, true);
  await publish(`${BASE}/bridge/groups`, groups, true);
  await publish(
    `${BASE}/bridge/info`,
    {
      version: '2.14.3-sim',
      coordinator: { ieee_address: '0x00124b0000000001', type: 'EmberZNet', meta: { revision: '8.0.2' } },
      network: { channel: 25, pan_id: 4660, extended_pan_id: '0xdddddddddddddddd' },
      permit_join: false,
      restart_required: false,
      // Zigbee2MQTT removes the network key and MQTT password before publishing its configuration.
      config: { advanced: { channel: 25 }, mqtt: { server: 'mqtt://127.0.0.1' }, serial: { adapter: 'ember' } },
    },
    true,
  );
  for (const d of devices) if (d.type !== 'Coordinator') await publish(`${BASE}/${d.friendly_name}/availability`, { state: 'online' }, true);

  await bridge.subscribeAsync([`${BASE}/+/set`, `${BASE}/+/get`, `${BASE}/bridge/request/#`], { qos: 1 });
  bridge.on('message', (topic, payload) => {
    if (topic.startsWith(`${BASE}/bridge/request/`)) {
      handleRequest(topic.slice(`${BASE}/bridge/request/`.length), payload.toString());
      return;
    }
    if (topic.endsWith('/get')) {
      // Answers "get" like a device: reports its current values again.
      const asked = topic.slice(BASE.length + 1, -'/get'.length);
      if (devices.some((d) => d.friendly_name === asked) && !offline.has(asked)) void publish(`${BASE}/${asked}`, state.get(asked) ?? {});
      return;
    }
    const name = topic.slice(BASE.length + 1, -'/set'.length);
    try {
      sets.push({ name, payload: JSON.parse(payload.toString()) as Record<string, unknown> });
    } catch {
      // Recorded only when it parses.
    }
    const group = groups.find((g) => g.friendly_name === name);
    if (group) {
      let command: Record<string, unknown> = {};
      try {
        command = JSON.parse(payload.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      for (const m of group.members) {
        const member = devices.find((d) => d.ieee_address === m.ieee_address);
        if (!member || offline.has(member.friendly_name)) continue;
        const current = state.get(member.friendly_name) ?? {};
        applyCommand(current, command);
        state.set(member.friendly_name, current);
        void publish(`${BASE}/${member.friendly_name}`, current);
      }
      return;
    }
    const device = devices.find((d) => d.friendly_name === name);
    if (!device || !device.definition || offline.has(name)) return;
    if (dropping.delete(name)) return;
    let command: Record<string, unknown>;
    try {
      command = JSON.parse(payload.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const current = state.get(name) ?? {};
    applyCommand(current, command);
    state.set(name, current);
    void publish(`${BASE}/${name}`, current);
  });

  function handleRequest(command: string, raw: string): void {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Z2M answers malformed requests with an error; so does the simulator.
    }
    const respond = (data: Record<string, unknown>, error?: string) =>
      void publish(`${BASE}/bridge/response/${command}`, {
        data,
        status: error ? 'error' : 'ok',
        ...(error ? { error } : {}),
        ...(body.transaction !== undefined ? { transaction: body.transaction } : {}),
      });
    requests.set(command, (requests.get(command) ?? 0) + 1);
    if (command === 'permit_join') {
      const time = Number(body.time);
      if (!Number.isInteger(time) || time < 0 || time > 254) return respond({}, 'Invalid time');
      permitJoinRequests.push(time);
      permitJoinDevices.push(typeof body.device === 'string' ? body.device : null);
      permitUntil = time === 0 ? 0 : Date.now() + time * 1000;
      return respond({ time });
    }
    if (command === 'device/interview' || command === 'device/configure') {
      const device = devices.find((d) => d.friendly_name === body.id || d.ieee_address === body.id);
      return device ? respond({ id: body.id }) : respond({}, "Device doesn't exist");
    }
    if (command === 'device/rename') {
      const device = devices.find((d) => d.friendly_name === body.from || d.ieee_address === body.from);
      if (!device || typeof body.to !== 'string' || body.to === '') return respond({}, "Device doesn't exist");
      const from = device.friendly_name;
      device.friendly_name = body.to;
      if (!sim.quietRenames) void publish(`${BASE}/bridge/devices`, devices, true);
      return respond({ from, to: body.to });
    }
    const publishGroups = () => void publish(`${BASE}/bridge/groups`, groups, true);
    const findGroup = (ref: unknown) => groups.find((g) => String(g.id) === String(ref) || g.friendly_name === ref);
    if (command === 'group/add') {
      const id = Number(body.id);
      if (typeof body.friendly_name !== 'string' || groups.some((g) => g.id === id || g.friendly_name === body.friendly_name)) return respond({}, 'Group exists');
      groups.push({ id, friendly_name: body.friendly_name, members: [] });
      publishGroups();
      return respond({ friendly_name: body.friendly_name, id });
    }
    if (command === 'group/remove') {
      const g = findGroup(body.id);
      if (!g) return respond({}, "Group doesn't exist");
      groups.splice(groups.indexOf(g), 1);
      publishGroups();
      return respond({ id: body.id });
    }
    if (command === 'group/members/add' || command === 'group/members/remove') {
      const g = findGroup(body.group);
      const d = devices.find((x) => x.ieee_address === body.device || x.friendly_name === body.device);
      if (!g || !d) return respond({}, "Group or device doesn't exist");
      if (offline.has(d.friendly_name)) return respond({}, `Failed to ${command.endsWith('add') ? 'add' : 'remove'} from group (Delivery failed)`);
      const endpoint = typeof body.endpoint === 'number' ? body.endpoint : 1;
      g.members = g.members.filter((m) => !(m.ieee_address === d.ieee_address && m.endpoint === endpoint));
      if (command === 'group/members/add') g.members.push({ ieee_address: d.ieee_address, endpoint });
      publishGroups();
      return respond({ group: body.group, device: body.device });
    }
    if (command === 'networkmap') {
      const coordinator = devices.find((d) => d.type === 'Coordinator');
      const nodes = devices.map((d) => ({ ieeeAddr: d.ieee_address, friendlyName: d.friendly_name, type: d.type }));
      const links = devices
        .filter((d) => d.type !== 'Coordinator' && coordinator)
        .map((d, i) => ({ source: { ieeeAddr: d.ieee_address }, target: { ieeeAddr: coordinator!.ieee_address }, lqi: 200 - i * 40, depth: 1, relationship: 1 }));
      return respond({ type: 'raw', routes: false, value: { nodes, links } });
    }
    if (command === 'device/remove') {
      const d = devices.find((x) => x.ieee_address === body.id || x.friendly_name === body.id);
      if (!d) return respond({}, "Device doesn't exist");
      devices = devices.filter((x) => x !== d);
      void publish(`${BASE}/bridge/devices`, devices, true);
      return respond({ id: body.id, block: false, force: body.force === true });
    }
    if (command === 'backup') {
      return respond({ zip: Buffer.from('simulated backup').toString('base64') });
    }
    respond({}, `Unknown request ${command}`);
  }

  const sim: Simulator = {
    port,
    url,
    get devices() {
      return devices;
    },
    sets,
    quietRenames: false,
    dropNext(friendlyName) {
      dropping.add(friendlyName);
    },
    async pressButton(friendlyName, action) {
      await publish(`${BASE}/${friendlyName}`, { action, battery: 68 });
    },
    async report(friendlyName, values) {
      const current = { ...(state.get(friendlyName) ?? {}), ...values };
      state.set(friendlyName, current);
      await publish(`${BASE}/${friendlyName}`, current);
    },
    async joinDevice(device) {
      if (Date.now() >= permitUntil) return false;
      devices = [...devices.filter((d) => d.ieee_address !== device.ieee_address), structuredClone(device)];
      await publish(`${BASE}/bridge/devices`, devices, true);
  await publish(`${BASE}/bridge/groups`, groups, true);
  await publish(
    `${BASE}/bridge/info`,
    {
      version: '2.14.3-sim',
      coordinator: { ieee_address: '0x00124b0000000001', type: 'EmberZNet', meta: { revision: '8.0.2' } },
      network: { channel: 25, pan_id: 4660, extended_pan_id: '0xdddddddddddddddd' },
      permit_join: false,
      restart_required: false,
      // Zigbee2MQTT removes the network key and MQTT password before publishing its configuration.
      config: { advanced: { channel: 25 }, mqtt: { server: 'mqtt://127.0.0.1' }, serial: { adapter: 'ember' } },
    },
    true,
  );
  for (const d of devices) if (d.type !== 'Coordinator') await publish(`${BASE}/${d.friendly_name}/availability`, { state: 'online' }, true);
      return true;
    },
    setOffline(friendlyName, isOffline) {
      if (isOffline) offline.add(friendlyName);
      else offline.delete(friendlyName);
      void publish(`${BASE}/${friendlyName}/availability`, { state: isOffline ? 'offline' : 'online' }, true);
    },
    groups,
    permitJoinRequests,
    permitJoinDevices,
    requests,
    pairingOpen() {
      return Date.now() < permitUntil;
    },
    async publishDevices(next) {
      if (next) devices = next;
      await publish(`${BASE}/bridge/devices`, devices, true);
  await publish(`${BASE}/bridge/groups`, groups, true);
  await publish(
    `${BASE}/bridge/info`,
    {
      version: '2.14.3-sim',
      coordinator: { ieee_address: '0x00124b0000000001', type: 'EmberZNet', meta: { revision: '8.0.2' } },
      network: { channel: 25, pan_id: 4660, extended_pan_id: '0xdddddddddddddddd' },
      permit_join: false,
      restart_required: false,
      // Zigbee2MQTT removes the network key and MQTT password before publishing its configuration.
      config: { advanced: { channel: 25 }, mqtt: { server: 'mqtt://127.0.0.1' }, serial: { adapter: 'ember' } },
    },
    true,
  );
  for (const d of devices) if (d.type !== 'Coordinator') await publish(`${BASE}/${d.friendly_name}/availability`, { state: 'online' }, true);
    },
    async close() {
      await bridge.endAsync();
      await new Promise<void>((resolve) => broker.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return sim;
}
