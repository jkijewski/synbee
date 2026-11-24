import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import mqtt, { type MqttClient } from 'mqtt';
import type { Db } from './db.js';
import { Devices } from './devices.js';
import { normalisePress, type ButtonPress } from './buttons.js';
import { flattenExposes, type ExposedProperty } from './exposes.js';
import { checkValues, confirms, relativeKeys, TRANSITION, withLightOn } from './features/index.js';
import type { LightMode } from './features/light-summary.js';
import { fitLightValues, isTuyaDatapoint, lightMessages, repeatable, supportsFade, withoutFade, withoutUnsupportedFade, z2mFriendlyName } from './device-kinds.js';
import { CommandError, type DeviceControl, type DeviceEvents, type GroupControl, type Z2mDevice, type Z2mGroup } from './ports.js';

export { CommandError, type Z2mDevice, type Z2mGroup } from './ports.js';

// Talks to Zigbee2MQTT over MQTT: keeps the device list in step with the registry and runs bridge requests.

/** What the hub shows about Zigbee2MQTT and the coordinator. Never includes the network key or configuration. */
export interface BridgeInfo {
  version: string | null;
  coordinator: { ieee: string | null; type: string | null; firmware: string | null };
  network: { channel: number | null; panId: number | null; extendedPanId: string | null };
  adapter: string | null;
  permitJoin: boolean;
  restartRequired: boolean;
}

export interface JoinedDevice {
  ieee: string;
  name: string;
  imported: boolean;
  at: string;
  interview: 'started' | 'successful' | 'failed' | 'unknown';
  supported: boolean | null;
  model: string | null;
}

export const MAX_PAIRING_SECONDS = 254;
/** Longest "Add devices" wait. Zigbee2MQTT opens joining for at most 254 s, so the hub re-opens it until then. */
export const MAX_PAIRING_MINUTES = 30;
/** Re-open a little before Zigbee2MQTT's own window closes, so joining never lapses. */
const REOPEN_EVERY_MS = 240_000;
/** Pause between the parts of one command to a Tuya datapoint light (colour, brightness, on). */
export const TUYA_PART_GAP_MS = 600;
/** Pause after switching a Tuya datapoint light on, before its colour or white is sent. */
export const TUYA_ON_GAP_MS = 700;
/** Stagger between the members of a group of Tuya datapoint lights, which are switched together. */
export const TUYA_MEMBER_STAGGER_MS = 100;

// Implements the device and group ports (0015) over MQTT; the typed `on`/`off` below are DeviceEvents.
export class ZigbeeBridge extends EventEmitter implements DeviceControl, GroupControl {
  private client: MqttClient | null = null;
  private pending = new Map<string, (msg: Record<string, unknown>) => void>();
  private devices = new Map<string, Z2mDevice>();
  private groupList: Z2mGroup[] = [];
  private pairingUntil = 0;
  /** The router devices join through while it is open, by IEEE address; null for anywhere in this network. */
  private pairingThrough: string | null = null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private joined: JoinedDevice[] = [];
  private availability = new Map<string, boolean>();
  /** Last availability per friendly name, for names not in the device list yet (just renamed or just joined). */
  private availabilityByName = new Map<string, boolean>();
  private bridgeState: boolean | null = null;
  private lastRefetch = 0;
  /** What each light shows, colour or white, as far as the hub knows (0009). */
  private modes = new Map<string, LightMode>();
  private info: BridgeInfo | null = null;
  private states = new Map<string, Record<string, unknown>>();
  private stateWaiters = new Set<{ ieee: string; check: (s: Record<string, unknown>) => boolean; resolve: () => void }>();

  constructor(
    private readonly db: Db,
    private readonly url: string,
    private readonly base = 'zigbee2mqtt',
    /** Shorter windows for tests; Zigbee2MQTT's limit is 254 s. */
    private readonly timing = { windowSeconds: MAX_PAIRING_SECONDS, reopenEveryMs: REOPEN_EVERY_MS },
  ) {
    super();
  }

  /** Emits a device event with its typed payload (DeviceEvents). */
  private publish<K extends keyof DeviceEvents>(event: K, payload: DeviceEvents[K]): void {
    this.emit(event, payload);
  }

  // Resolves once connected; keeps retrying in the background if the broker isn't up yet.
  start(): Promise<void> {
    const client = mqtt.connect(this.url, { clientId: `synbee-${crypto.randomUUID()}`, reconnectPeriod: 2000 });
    this.client = client;
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
    client.on('error', (err) => this.emit('warning', `MQTT: ${err.message}`));
    // Without the broker the hub hears nothing from Zigbee2MQTT, so the gateway counts as gone until it says otherwise.
    client.on('close', () => {
      if (this.bridgeState !== false) {
        this.bridgeState = false;
        this.publish('gateway', { online: false });
      }
    });
    return new Promise((resolve) => {
      client.on('connect', () => {
        const topics = ['bridge/devices', 'bridge/groups', 'bridge/info', 'bridge/state', 'bridge/event', 'bridge/response/#', '+', '+/availability'];
        void client.subscribeAsync(topics.map((t) => `${this.base}/${t}`), { qos: 1 }).then(() => resolve());
      });
    });
  }

  connected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Whether Zigbee2MQTT is up and talking to the gateway: it publishes bridge/state "online" once the gateway answers,
   * and the broker publishes "offline" for it (its last will) when it stops, for example because the gateway is gone.
   */
  gatewayOnline(): boolean | null {
    if (!this.connected()) return false;
    return this.bridgeState;
  }

  async stop(): Promise<void> {
    this.clearPairingTimer();
    await this.client?.endAsync();
    this.client = null;
  }

  knownDevices(): Z2mDevice[] {
    return [...this.devices.values()];
  }

  groups(): Z2mGroup[] {
    return this.groupList;
  }

  bridgeInfo(): BridgeInfo | null {
    return this.info;
  }

  /** True or false once Zigbee2MQTT has reported the device's availability, otherwise undefined. */
  isOnline(ieee: string): boolean | undefined {
    return this.availability.get(ieee.toLowerCase());
  }

  pairingState(): { open: boolean; secondsLeft: number; until: string | null; through: string | null; joined: JoinedDevice[] } {
    const left = Math.max(0, Math.ceil((this.pairingUntil - Date.now()) / 1000));
    return { open: left > 0, secondsLeft: left, until: left > 0 ? new Date(this.pairingUntil).toISOString() : null, through: left > 0 ? this.pairingThrough : null, joined: this.joined };
  }

  /** Zigbee2MQTT's permit_join, through one router when chosen: then only that device lets new devices in. */
  private permitJoin(time: number): Promise<Record<string, unknown>> {
    const through = this.pairingThrough ? this.devices.get(this.pairingThrough)?.friendly_name : undefined;
    return this.request('permit_join', through && time > 0 ? { time, device: through } : { time });
  }

  /** Opens joining for up to 254 s, as Zigbee2MQTT allows in one request. */
  async openPairing(seconds: number, through: string | null = null): Promise<ReturnType<ZigbeeBridge['pairingState']>> {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_PAIRING_SECONDS) {
      throw new RangeError(`Pairing time must be 1 to ${MAX_PAIRING_SECONDS} seconds`);
    }
    return this.openPairingUntil(Date.now() + seconds * 1000, through);
  }

  /** "Add devices, wait up to N minutes": keeps joining open by re-opening it before each Zigbee2MQTT window ends. */
  async openPairingMinutes(minutes: number, through: string | null = null): Promise<ReturnType<ZigbeeBridge['pairingState']>> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PAIRING_MINUTES) {
      throw new RangeError(`Waiting time must be 1 to ${MAX_PAIRING_MINUTES} minutes`);
    }
    return this.openPairingUntil(Date.now() + minutes * 60_000, through);
  }

  /** Devices that can let others join: routers (mains-powered lights, plugs, switches), not battery devices. */
  routers(): Z2mDevice[] {
    return this.knownDevices().filter((d) => d.type === 'Router');
  }

  private async openPairingUntil(until: number, through: string | null = null): Promise<ReturnType<ZigbeeBridge['pairingState']>> {
    const wasOpen = this.pairingState().open;
    this.clearPairingTimer();
    if (through && this.devices.get(through.toLowerCase())?.type !== 'Router') throw new RangeError('Choose a mains-powered device (a router) to join through');
    this.pairingThrough = through ? through.toLowerCase() : null;
    await this.permitJoin(Math.min(this.timing.windowSeconds, Math.ceil((until - Date.now()) / 1000)));
    if (!wasOpen) this.joined = [];
    this.pairingUntil = until;
    this.schedulePairingRefresh();
    return this.pairingState();
  }

  private schedulePairingRefresh(): void {
    const left = this.pairingUntil - Date.now();
    if (left <= this.timing.windowSeconds * 1000) return;
    this.pairingTimer = setTimeout(() => {
      this.pairingTimer = null;
      const remaining = Math.ceil((this.pairingUntil - Date.now()) / 1000);
      if (remaining <= 0) return;
      this.permitJoin(Math.min(this.timing.windowSeconds, remaining)).then(
        () => this.schedulePairingRefresh(),
        (err: Error) => {
          this.emit('warning', `Could not keep joining open: ${err.message}`);
          // Try again shortly; the current window is still open for a while.
          this.pairingTimer = setTimeout(() => this.schedulePairingRefresh(), 5000);
        },
      );
    }, Math.min(this.timing.reopenEveryMs, left - 1000));
    this.pairingTimer.unref?.();
  }

  private clearPairingTimer(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
  }

  async closePairing(): Promise<void> {
    this.clearPairingTimer();
    await this.request('permit_join', { time: 0 });
    this.pairingUntil = 0;
    this.pairingThrough = null;
  }

  /** Creates a Zigbee2MQTT group with the given members; the friendly name is the ASCII form of the display name. */
  async createGroup(display: string, members: Array<{ ieee: string; endpoint?: number }>): Promise<Z2mGroup> {
    const id = Math.max(0, ...this.groupList.map((g) => g.id)) + 1;
    const friendlyName = z2mFriendlyName(display);
    if (this.groupList.some((g) => g.friendly_name === friendlyName)) throw new CommandError('A group with this name already exists', 409);
    await this.request('group/add', { friendly_name: friendlyName, id });
    for (const m of members) await this.addGroupMember(id, m.ieee, m.endpoint);
    return { id, friendly_name: friendlyName, members: members.map((m) => ({ ieee_address: m.ieee, endpoint: m.endpoint ?? 1 })) };
  }

  async addGroupMember(group: number, ieee: string, endpoint?: number): Promise<void> {
    await this.request('group/members/add', { group: String(group), device: ieee, ...(endpoint !== undefined ? { endpoint } : {}) });
  }

  async removeGroupMember(group: number, ieee: string, endpoint?: number): Promise<void> {
    await this.request('group/members/remove', { group: String(group), device: ieee, ...(endpoint !== undefined ? { endpoint } : {}) });
  }

  async removeGroup(group: number): Promise<void> {
    await this.request('group/remove', { id: String(group) });
  }

  /** Properties a group can be set to: those its first recognised member offers. */
  groupProperties(group: number): ExposedProperty[] {
    const g = this.groupList.find((x) => x.id === group);
    for (const m of g?.members ?? []) {
      const d = this.devices.get(m.ieee_address.toLowerCase());
      if (d?.definition) return flattenExposes(d.definition.exposes);
    }
    return [];
  }

  /**
   * Sends values to a whole group with one Zigbee broadcast. Groups don't confirm, so this only checks the values and
   * that Zigbee2MQTT accepted the message.
   */
  async groupCommand(group: number, values: Record<string, unknown>): Promise<void> {
    if (!this.client?.connected) throw new CommandError('Not connected to Zigbee2MQTT', 503);
    const g = this.groupList.find((x) => x.id === group);
    if (!g) throw new CommandError('Unknown group', 404);
    if (g.members.length === 0) throw new CommandError('The group has no devices yet', 409);
    const problem = checkValues(this.groupProperties(group), values);
    if (problem) throw new CommandError(problem.replace('this can do', "this group's devices can do"), 400);
    const members = g.members.map((m) => this.devices.get(m.ieee_address.toLowerCase())).filter((d): d is Z2mDevice => Boolean(d));
    // Tuya "datapoint" devices (TS0601, such as Skydance WZ5 LED controllers) can't take colour or brightness as a
    // Zigbee group broadcast, so each member gets the command itself. A fade goes only if every member supports one.
    if (members.some(isTuyaDatapoint)) {
      const failed: string[] = [];
      // Like a broadcast, each member takes only what it can do: a white-only light in the group ignores a colour.
      const own = (d: Z2mDevice) => {
        const props = flattenExposes(d.definition?.exposes);
        const relative = relativeKeys(props);
        return Object.fromEntries(Object.entries(values).filter(([k]) => k === TRANSITION || relative.has(k) || props.some((p) => p.property === k)));
      };
      // All lights at once, each with its own paced messages (lightMessages); a short stagger keeps their first
      // messages from leaving the coordinator at the same instant.
      await Promise.all(
        members.map(async (d, i) => {
          const mine = own(d);
          if (Object.keys(mine).every((k) => k === TRANSITION)) return;
          await new Promise((r) => setTimeout(r, i * TUYA_MEMBER_STAGGER_MS));
          await this.command(d.ieee_address, mine).catch((err: Error) => {
            failed.push(`${d.friendly_name}: ${err.message}`);
          });
        }),
      );
      if (failed.length) throw new CommandError(`Not every light confirmed: ${failed.join('; ')}`, 504);
      return;
    }
    // Per-member commands above switch each light on themselves; a broadcast does it here (0009).
    const lit = withLightOn(this.groupProperties(group), values);
    const sent = members.every(supportsFade) ? lit : withoutFade(lit);
    await this.client.publishAsync(`${this.base}/${g.friendly_name}/set`, JSON.stringify(sent), { qos: 1 });
  }

  deviceState(ieee: string): Record<string, unknown> | undefined {
    return this.states.get(ieee.toLowerCase());
  }

  // Sends values to a device and waits until it reports them back, so a silent device counts as a failure.
  async command(ieee: string, values: Record<string, unknown>, timeoutMs = 5000): Promise<Record<string, unknown>> {
    if (!this.client?.connected) throw new CommandError('Not connected to Zigbee2MQTT', 503);
    const device = this.devices.get(ieee.toLowerCase());
    if (!device) throw new CommandError('Unknown device', 404);
    if (!device.definition) throw new CommandError('Device is not recognised, so it has no controls', 409);
    const props = flattenExposes(device.definition.exposes);
    // A colour, brightness or white temperature means "show me this", from a step as from the device page (0009).
    values = withLightOn(props, values);
    const problem = checkValues(props, values);
    if (problem) throw new CommandError(problem, 400);
    values = fitLightValues(device, props, withoutUnsupportedFade(device, values));
    const current = this.states.get(device.ieee_address.toLowerCase()) ?? {};
    const parts = lightMessages(device, props, values).filter(
      // A light that is already on needs no extra "on" message before its new look.
      (part, i, all) => !(all.length > 1 && i === 0 && Object.keys(part).length === 1 && part.state !== undefined && part.state === current.state),
    );
    let state: Record<string, unknown> = {};
    // Remember the look sent: lights like the WZ5 never report whether they show colour or white.
    const ieeeKey = device.ieee_address.toLowerCase();
    if ('color' in values) this.modes.set(ieeeKey, 'color');
    else if ('color_temp' in values || 'white_brightness' in values) this.modes.set(ieeeKey, 'white');
    for (const [i, part] of parts.entries()) {
      // Zigbee2MQTT confirms at once from its own cache; a Tuya datapoint light needs time to apply each part (longer
      // to come on), or it drops the next one.
      if (i > 0 && isTuyaDatapoint(device)) await new Promise((r) => setTimeout(r, parts[i - 1]!.state !== undefined ? TUYA_ON_GAP_MS : TUYA_PART_GAP_MS));
      state = await this.sendConfirmed(device, props, part, timeoutMs);
    }
    return state;
  }

  /** Sends values to a device and waits until it reports them, retrying once when that is safe. */
  private async sendConfirmed(device: Z2mDevice, props: ExposedProperty[], values: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const relative = relativeKeys(props);
    // What the device should report back. Undefined means "any new report of it", for toggles from an unknown state
    // and relative changes; numbers are compared with each feature's tolerance.
    const expected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === TRANSITION) continue;
      const rel = relative.get(key);
      if (rel) {
        expected[rel.property] = undefined;
        continue;
      }
      const prop = props.find((p) => p.property === key)!;
      if (value === prop.valueToggle) {
        const current = this.states.get(device.ieee_address.toLowerCase())?.[key];
        expected[key] = current === prop.valueOn ? prop.valueOff : current === prop.valueOff ? prop.valueOn : undefined;
      } else {
        expected[key] = value;
      }
    }
    // A fade reports its final value at the end, so wait for it as well.
    if (typeof values[TRANSITION] === 'number') timeoutMs += (values[TRANSITION] as number) * 1000;
    const ieeeKey = device.ieee_address.toLowerCase();
    const check = (s: Record<string, unknown>) =>
      Object.entries(expected).every(([k, v]) => (v === undefined ? k in s : confirms(props.find((p) => p.property === k), v, s[k])));
    const send = async (payload: Record<string, unknown>) => {
      const confirmed = this.waitForState(ieeeKey, check, timeoutMs);
      await this.client!.publishAsync(`${this.base}/${device.friendly_name}/set`, JSON.stringify(payload), { qos: 1 });
      await confirmed;
    };
    try {
      await send(values);
    } catch (err) {
      // A device now and then misses a message (seen with a WZ5 controller on the real network). Send once more, but
      // only what can't apply twice: a toggle becomes its target value, and relative changes aren't repeated.
      const retry = repeatable(values, expected, relative);
      if (!(err instanceof CommandError) || err.status !== 504 || !retry || !this.client?.connected) throw err;
      await send(retry);
    }
    return this.states.get(ieeeKey) ?? {};
  }

  /** Resolves when the device reports a state that passes `check`; rejects with 504 after `timeoutMs`. */
  private waitForState(ieee: string, check: (s: Record<string, unknown>) => boolean, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        ieee,
        check,
        resolve: () => {
          clearTimeout(timer);
          this.stateWaiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        this.stateWaiters.delete(waiter);
        reject(new CommandError('The device did not confirm the change', 504));
      }, timeoutMs);
      this.stateWaiters.add(waiter);
    });
  }

  async refresh(ieee: string, properties: string[], timeoutMs = 5000): Promise<Record<string, unknown>> {
    if (!this.client?.connected) throw new CommandError('Not connected to Zigbee2MQTT', 503);
    const device = this.devices.get(ieee.toLowerCase());
    if (!device?.definition) throw new CommandError('Unknown device', 404);
    const gettable = new Set(flattenExposes(device.definition.exposes).filter((p) => p.gettable).map((p) => p.property));
    const asked = properties.filter((p) => gettable.has(p));
    if (asked.length === 0) throw new CommandError('This device can only report changes; it cannot be asked', 400);
    const key = ieee.toLowerCase();
    const reported = new Promise<void>((resolve, reject) => {
      const waiter = {
        ieee: key,
        check: () => true,
        resolve: () => {
          clearTimeout(timer);
          this.stateWaiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        this.stateWaiters.delete(waiter);
        reject(new CommandError('The device did not answer; it may be asleep (battery devices wake only now and then)', 504));
      }, timeoutMs);
      this.stateWaiters.add(waiter);
    });
    await this.client.publishAsync(`${this.base}/${device.friendly_name}/get`, JSON.stringify(Object.fromEntries(asked.map((p) => [p, '']))), { qos: 1 });
    await reported;
    return this.states.get(key) ?? {};
  }

  async request(command: string, payload: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
    if (!this.client?.connected) throw new Error('Not connected to Zigbee2MQTT');
    const transaction = crypto.randomUUID();
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transaction);
        reject(new Error(`Zigbee2MQTT did not answer ${command}`));
      }, timeoutMs);
      this.pending.set(transaction, (msg) => {
        clearTimeout(timer);
        this.pending.delete(transaction);
        if (msg.status === 'ok') resolve((msg.data as Record<string, unknown>) ?? {});
        else reject(new Error(`Zigbee2MQTT refused ${command}: ${String(msg.error ?? 'unknown error')}`));
      });
    });
    await this.client.publishAsync(`${this.base}/bridge/request/${command}`, JSON.stringify({ ...payload, transaction }), { qos: 1 });
    return reply;
  }

  private onMessage(topic: string, payload: Buffer): void {
    const sub = topic.slice(this.base.length + 1);
    if (sub === 'bridge/state') {
      let state: unknown = payload.toString();
      try {
        state = (JSON.parse(payload.toString()) as { state?: unknown }).state;
      } catch {
        // Older Zigbee2MQTT versions publish a plain "online" / "offline".
      }
      if (state !== 'online' && state !== 'offline') return;
      const online = state === 'online';
      if (this.bridgeState !== online) {
        this.bridgeState = online;
        this.publish('gateway', { online });
      }
      return;
    }
    if (sub.endsWith('/availability') && !sub.startsWith('bridge/')) {
      this.onAvailability(sub.slice(0, -'/availability'.length), payload.toString());
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (sub === 'bridge/devices' && Array.isArray(body)) {
      void this.syncDevices(body as Z2mDevice[]);
    } else if (sub === 'bridge/groups' && Array.isArray(body)) {
      this.groupList = (body as Z2mGroup[]).filter((g) => g && typeof g.id === 'number');
      this.emit('groups', this.groupList);
    } else if (sub === 'bridge/info' && body && typeof body === 'object') {
      this.onInfo(body as Record<string, unknown>);
    } else if (sub === 'bridge/event' && body && typeof body === 'object') {
      this.onBridgeEvent(body as { type?: string; data?: Record<string, unknown> });
    } else if (!sub.startsWith('bridge/') && body && typeof body === 'object' && !Array.isArray(body)) {
      this.onDeviceMessage(sub, body as Record<string, unknown>);
    } else if (sub.startsWith('bridge/response/') && body && typeof body === 'object') {
      const msg = body as Record<string, unknown>;
      const handler = typeof msg.transaction === 'string' ? this.pending.get(msg.transaction) : undefined;
      handler?.(msg);
    }
  }

  private onAvailability(friendlyName: string, raw: string): void {
    let state: unknown = raw;
    try {
      state = (JSON.parse(raw) as { state?: unknown }).state;
    } catch {
      // Older Zigbee2MQTT versions publish a plain "online" / "offline".
    }
    // An empty message only clears the retained topic of an old name after a rename; it says nothing.
    if (state !== 'online' && state !== 'offline') return;
    const online = state === 'online';
    this.availabilityByName.set(friendlyName, online);
    const device = [...this.devices.values()].find((d) => d.friendly_name === friendlyName);
    if (device) this.setAvailability(device.ieee_address.toLowerCase(), online);
  }

  private setAvailability(ieee: string, online: boolean): void {
    if (this.availability.get(ieee) !== online) {
      this.availability.set(ieee, online);
      this.publish('availability', { ieee, online });
    }
  }

  // Copies only what the hub shows. The configuration (with the MQTT password removed by Zigbee2MQTT) is ignored.
  private onInfo(body: Record<string, unknown>): void {
    const coordinator = (body.coordinator ?? {}) as Record<string, unknown>;
    const meta = (coordinator.meta ?? {}) as Record<string, unknown>;
    const network = (body.network ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
    this.info = {
      version: str(body.version),
      coordinator: {
        ieee: str(coordinator.ieee_address),
        type: str(coordinator.type),
        firmware: meta.revision !== undefined ? str(meta.revision) : null,
      },
      network: {
        channel: typeof network.channel === 'number' ? network.channel : null,
        panId: typeof network.pan_id === 'number' ? network.pan_id : null,
        extendedPanId: str(network.extended_pan_id),
      },
      // Only the adapter type is read from the configuration.
      adapter: str(((body.config as { serial?: { adapter?: unknown } } | undefined)?.serial ?? {}).adapter),
      permitJoin: body.permit_join === true,
      restartRequired: body.restart_required === true,
    };
    this.emit('info', this.info);
  }

  private onBridgeEvent(event: { type?: string; data?: Record<string, unknown> }): void {
    if (event.type !== 'device_interview' || !event.data) return;
    const ieee = String(event.data.ieee_address ?? '').toLowerCase();
    const entry = this.joined.find((j) => j.ieee === ieee);
    const status = event.data.status;
    if (entry && (status === 'started' || status === 'successful' || status === 'failed')) {
      entry.interview = status;
      if (status === 'successful') {
        const def = event.data.definition as { model?: string } | null | undefined;
        entry.supported = event.data.supported === true;
        entry.model = def?.model ?? null;
      }
      this.emit('interview', { ...entry });
    }
  }

  /**
   * A message from a device name the hub doesn't know means its device list is out of date (a rename it missed, say).
   * Subscribing again delivers Zigbee2MQTT's retained device list. At most once a minute.
   */
  private refetchDevices(friendlyName: string): void {
    const now = Date.now();
    if (!this.client?.connected || now - this.lastRefetch < 60_000) return;
    this.lastRefetch = now;
    this.emit('warning', `Message from unknown device "${friendlyName}"; reading the device list again`);
    const topic = `${this.base}/bridge/devices`;
    void this.client
      .unsubscribeAsync(topic)
      .then(() => this.client?.subscribeAsync(topic, { qos: 1 }))
      .catch(() => undefined);
  }

  private onDeviceMessage(friendlyName: string, payload: Record<string, unknown>): void {
    const device = [...this.devices.values()].find((d) => d.friendly_name === friendlyName);
    if (!device) {
      // Light groups report their state under their own names; those aren't devices.
      if (!this.groupList.some((g) => g.friendly_name === friendlyName)) this.refetchDevices(friendlyName);
      return;
    }
    const ieee = device.ieee_address.toLowerCase();
    const { action, ...rest } = payload;
    // A light that reports its colour mode says what it shows; Tuya datapoint lights only echo a cached one.
    if (!isTuyaDatapoint(device) && typeof rest.color_mode === 'string') {
      this.modes.set(device.ieee_address.toLowerCase(), rest.color_mode === 'color_temp' ? 'white' : 'color');
    }
    const previous = this.states.get(ieee) ?? {};
    const state = { ...previous, ...rest };
    const changed = Object.keys(rest).filter((k) => JSON.stringify(previous[k]) !== JSON.stringify(rest[k]));
    this.states.set(ieee, state);
    for (const waiter of [...this.stateWaiters]) {
      if (waiter.ieee === ieee && waiter.check(state)) waiter.resolve();
    }
    this.publish('state', { ieee, state, previous, changed });
    if (action !== undefined && action !== '') {
      const press: ButtonPress | null = normalisePress(device.definition?.model, action);
      this.publish('button', { ieee, raw: action, ...(press ?? {}) });
    }
  }

  // Marks imported devices as joined (renaming them in Zigbee2MQTT to their imported name) and registers new ones.
  private async syncDevices(list: Z2mDevice[]): Promise<void> {
    this.devices = new Map(list.filter((d) => d.type !== 'Coordinator').map((d) => [d.ieee_address.toLowerCase(), d]));
    // Availability that arrived under a name before this list did (a rename, a new device).
    for (const [ieee, d] of this.devices) {
      const online = this.availabilityByName.get(d.friendly_name);
      if (online !== undefined) this.setAvailability(ieee, online);
    }
    const registry = new Devices(this.db);

    for (const [ieee, device] of this.devices) {
      if (!/^0x[0-9a-f]{16}$/.test(ieee)) continue;
      const row = registry.get(ieee);
      const entry = this.joined.find((j) => j.ieee === ieee);
      if (entry && device.interview_completed) {
        entry.interview = 'successful';
        entry.supported = device.supported;
        entry.model = device.definition?.model ?? device.model_id ?? null;
      }
      if (!row) {
        registry.addPaired(ieee, device.friendly_name);
        this.noteJoined(ieee, device.friendly_name, false, device);
        this.publish('device-joined', { ieee, name: device.friendly_name, imported: false });
      } else if (row.status === 'pending') {
        registry.markJoined(ieee);
        this.noteJoined(ieee, row.name, true, device);
        const wanted = z2mFriendlyName(row.name);
        if (device.friendly_name !== wanted) {
          try {
            await this.renameTo(ieee, this.uniqueFriendlyName(wanted, ieee));
          } catch (err) {
            this.emit('warning', `Could not rename ${ieee} to "${wanted}": ${(err as Error).message}`);
          }
        }
        this.publish('device-joined', { ieee, name: row.name, imported: true });
      }
    }
    this.emit('devices', this.knownDevices());
  }

  lightMode(ieee: string): LightMode | null {
    return this.modes.get(ieee.toLowerCase()) ?? null;
  }

  async rename(ieee: string, displayName: string): Promise<void> {
    const key = ieee.toLowerCase();
    await this.renameTo(key, this.uniqueFriendlyName(z2mFriendlyName(displayName), key));
  }

  /**
   * Renames a device in Zigbee2MQTT and takes the new name over at once. Zigbee2MQTT also publishes a new device list,
   * but until that arrives (or if it is missed) the device's messages would come under a name the hub doesn't know.
   */
  private async renameTo(ieee: string, to: string): Promise<void> {
    const reply = await this.request('device/rename', { from: ieee, to });
    const name = typeof reply.to === 'string' && reply.to ? reply.to : to;
    const device = this.devices.get(ieee);
    if (device) this.devices.set(ieee, { ...device, friendly_name: name });
  }

  async interview(ieee: string): Promise<void> {
    await this.request('device/interview', { id: ieee.toLowerCase() }, 60000);
  }

  async configure(ieee: string): Promise<void> {
    await this.request('device/configure', { id: ieee.toLowerCase() }, 30000);
  }

  async leave(ieee: string): Promise<void> {
    await this.request('device/remove', { id: ieee.toLowerCase(), force: false }, 30000);
  }

  /** A friendly name no other device or group uses, adding _2, _3… when needed. */
  uniqueFriendlyName(wanted: string, ieee: string): string {
    const taken = new Set([
      ...[...this.devices.values()].filter((d) => d.ieee_address.toLowerCase() !== ieee).map((d) => d.friendly_name),
      ...this.groupList.map((g) => g.friendly_name),
    ]);
    let name = wanted;
    for (let i = 2; taken.has(name); i++) name = `${wanted}_${i}`;
    return name;
  }

  private noteJoined(ieee: string, name: string, imported: boolean, device: Z2mDevice): void {
    if (this.joined.some((j) => j.ieee === ieee)) return;
    this.joined.push({
      ieee,
      name,
      imported,
      at: new Date().toISOString(),
      interview: device.interview_completed ? 'successful' : 'started',
      supported: device.interview_completed ? device.supported : null,
      model: device.definition?.model ?? device.model_id ?? null,
    });
  }
}

