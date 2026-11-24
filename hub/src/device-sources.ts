import { EventEmitter } from 'node:events';
import type { ExposedProperty } from './exposes.js';
import type { LightMode } from './features/light-summary.js';
import { CommandError, type DeviceControl, type DeviceEvents, type GroupControl, type Z2mDevice, type Z2mGroup } from './ports.js';

// Device sources (0023): the hexagon's edge. The core (rules, actions, groups, rooms, history, the app) uses the ports
// DeviceControl and GroupControl and never knows where a device lives. Each source is an adapter behind those ports:
// today one Zigbee2MQTT per gateway, later a Matter/Thread controller. DeviceSources is the router that presents them
// all as one: it sends each command to the source that knows the device, and passes on every source's events.
//
// Zigbee group ids are 16-bit and per network, so a group of source n is seen by the core as (n - 1) * 65536 + id; the
// first source's ids are unchanged. Groups of the same name on several sources are one group to the core (a light
// group whose lights are on several gateways): commands go to each part.

export interface DeviceSource extends DeviceControl, GroupControl {}

export interface SourceEntry {
  /** 1 for the first gateway; stable for the source's life. */
  id: number;
  source: DeviceSource;
}

export const GROUP_SPAN = 65536;

const EVENTS: Array<keyof DeviceEvents> = ['state', 'button', 'availability', 'device-joined', 'gateway'];

export class DeviceSources extends EventEmitter implements DeviceControl, GroupControl {
  private entries: SourceEntry[] = [];
  private readonly forward = new Map<DeviceSource, Array<[string, (...a: unknown[]) => void]>>();

  constructor(entries: SourceEntry[] = []) {
    super();
    for (const e of entries) this.add(e);
  }

  add(entry: SourceEntry): void {
    if (this.entries.some((e) => e.id === entry.id)) throw new Error(`Source ${entry.id} exists`);
    this.entries = [...this.entries, entry].sort((a, b) => a.id - b.id);
    const handlers: Array<[string, (...a: unknown[]) => void]> = EVENTS.map((event) => [
      event,
      (payload: unknown) => this.emit(event, event === 'gateway' ? { ...(payload as object), source: entry.id } : payload),
    ]);
    handlers.push(['warning', (msg: unknown) => this.emit('warning', msg)]);
    for (const [event, h] of handlers) entry.source.on(event as keyof DeviceEvents, h as never);
    this.forward.set(entry.source, handlers);
  }

  remove(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    for (const [event, h] of this.forward.get(entry.source) ?? []) entry.source.off(event as keyof DeviceEvents, h as never);
    this.forward.delete(entry.source);
    this.entries = this.entries.filter((e) => e !== entry);
  }

  list(): SourceEntry[] {
    return this.entries;
  }

  /** The source a device is on, by its id; undefined when no source knows it (yet). */
  sourceOf(ieee: string): SourceEntry | undefined {
    const id = ieee.toLowerCase();
    return this.entries.find((e) => e.source.knownDevices().some((d) => d.ieee_address.toLowerCase() === id));
  }

  private owner(ieee: string): DeviceSource {
    const e = this.sourceOf(ieee);
    if (!e) throw new CommandError('Unknown device, or its gateway is not connected', 404);
    return e.source;
  }

  connected(): boolean {
    return this.entries.some((e) => e.source.connected());
  }

  knownDevices(): Z2mDevice[] {
    return this.entries.flatMap((e) => e.source.knownDevices());
  }

  deviceState(ieee: string): Record<string, unknown> | undefined {
    return this.sourceOf(ieee)?.source.deviceState(ieee);
  }

  async command(ieee: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.owner(ieee).command(ieee, values);
  }

  isOnline(ieee: string): boolean | undefined {
    return this.sourceOf(ieee)?.source.isOnline(ieee);
  }

  /** Every source up: true; any of them down: false; null until they have all said. */
  gatewayOnline(): boolean | null {
    const states = this.entries.map((e) => e.source.gatewayOnline());
    if (states.length === 0) return null;
    if (states.some((s) => s === false)) return false;
    return states.every((s) => s === true) ? true : null;
  }

  async refresh(ieee: string, properties: string[]): Promise<Record<string, unknown>> {
    return this.owner(ieee).refresh(ieee, properties);
  }

  lightMode(ieee: string): LightMode | null {
    return this.sourceOf(ieee)?.source.lightMode(ieee) ?? null;
  }

  async rename(ieee: string, displayName: string): Promise<void> {
    return this.owner(ieee).rename(ieee, displayName);
  }

  async interview(ieee: string): Promise<void> {
    return this.owner(ieee).interview(ieee);
  }

  async configure(ieee: string): Promise<void> {
    return this.owner(ieee).configure(ieee);
  }

  async leave(ieee: string): Promise<void> {
    return this.owner(ieee).leave(ieee);
  }

  // Groups: global ids, merged by name across sources.

  private parts(global: number): Array<{ entry: SourceEntry; group: Z2mGroup }> {
    const home = this.entries.find((e) => e.id === Math.floor(global / GROUP_SPAN) + 1);
    const first = home?.source.groups().find((g) => g.id === global % GROUP_SPAN);
    if (!home || !first) return [];
    return this.entries.flatMap((entry) => {
      const g = entry === home ? first : entry.source.groups().find((x) => x.friendly_name === first.friendly_name);
      return g ? [{ entry, group: g }] : [];
    });
  }

  groups(): Z2mGroup[] {
    const byName = new Map<string, Z2mGroup>();
    for (const e of this.entries) {
      for (const g of e.source.groups()) {
        const seen = byName.get(g.friendly_name);
        if (seen) seen.members = [...seen.members, ...g.members];
        else byName.set(g.friendly_name, { ...g, id: (e.id - 1) * GROUP_SPAN + g.id, members: [...g.members] });
      }
    }
    return [...byName.values()];
  }

  groupProperties(group: number): ExposedProperty[] {
    const seen = new Map<string, ExposedProperty>();
    for (const { entry, group: g } of this.parts(group)) for (const p of entry.source.groupProperties(g.id)) if (!seen.has(p.property)) seen.set(p.property, p);
    return [...seen.values()];
  }

  /** A group on the source of its first member; members on other sources get a part of the same name there. */
  async createGroup(display: string, members: Array<{ ieee: string; endpoint?: number }>): Promise<Z2mGroup> {
    const bySource = new Map<SourceEntry, Array<{ ieee: string; endpoint?: number }>>();
    for (const m of members) {
      const e = this.sourceOf(m.ieee);
      if (!e) throw new CommandError(`${m.ieee} is not on any connected gateway`, 409);
      bySource.set(e, [...(bySource.get(e) ?? []), m]);
    }
    let first: Z2mGroup | null = null;
    for (const [entry, list] of bySource) {
      const g = await entry.source.createGroup(display, list);
      if (!first) first = { ...g, id: (entry.id - 1) * GROUP_SPAN + g.id };
    }
    if (!first) throw new CommandError('Choose at least one device', 400);
    return this.groups().find((g) => g.id === first!.id) ?? first;
  }

  async addGroupMember(group: number, ieee: string, endpoint?: number): Promise<void> {
    const parts = this.parts(group);
    if (parts.length === 0) throw new CommandError('Unknown group', 404);
    const e = this.sourceOf(ieee);
    if (!e) throw new CommandError(`${ieee} is not on any connected gateway`, 409);
    const part = parts.find((p) => p.entry === e);
    if (part) await e.source.addGroupMember(part.group.id, ieee, endpoint);
    else await e.source.createGroup(parts[0]!.group.friendly_name, [{ ieee, endpoint }]);
  }

  async removeGroupMember(group: number, ieee: string, endpoint?: number): Promise<void> {
    const part = this.parts(group).find((p) => p.group.members.some((m) => m.ieee_address.toLowerCase() === ieee.toLowerCase()));
    if (!part) throw new CommandError('Not a member of this group', 404);
    await part.entry.source.removeGroupMember(part.group.id, ieee, endpoint);
  }

  async removeGroup(group: number): Promise<void> {
    for (const { entry, group: g } of this.parts(group)) await entry.source.removeGroup(g.id);
  }

  /** Each part gets the command on its own source, at the same time. */
  async groupCommand(group: number, values: Record<string, unknown>): Promise<void> {
    const parts = this.parts(group);
    if (parts.length === 0) throw new CommandError('Unknown group', 404);
    const results = await Promise.allSettled(parts.map(({ entry, group: g }) => entry.source.groupCommand(g.id, values)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length === results.length) throw failed[0]!.reason;
    if (failed.length) throw new CommandError(`Not every gateway's lights confirmed: ${failed.map((f) => (f.reason as Error).message).join('; ')}`, 504);
  }
}
