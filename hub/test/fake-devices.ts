import { EventEmitter } from 'node:events';
import { normalisePress } from '../src/buttons.js';
import { flattenExposes, type ExposedProperty } from '../src/exposes.js';
import { checkValues } from '../src/features/index.js';
import { CommandError, type DeviceControl, type DeviceEvents, type GroupControl, type Z2mDevice, type Z2mGroup } from '../src/ports.js';
import { sampleBulbs, sampleDevices, sampleSensors } from '../src/sim/sample-devices.js';

// An in-memory stand-in for the Zigbee2MQTT bridge, implementing the device and group ports (0015), so modules can
// be tested without MQTT or the simulator. Commands apply at once and report state like a real device would.
export class FakeDevices extends EventEmitter implements DeviceControl, GroupControl {
  readonly commands: Array<{ target: string | number; values: Record<string, unknown> }> = [];
  private readonly devices: Z2mDevice[];

  /** With `only`, just those devices (by IEEE address): a second gateway in tests (0023). */
  constructor(only?: string[]) {
    super();
    const all = [...sampleDevices, ...sampleBulbs, ...sampleSensors].filter((d) => d.type !== 'Coordinator') as unknown as Z2mDevice[];
    this.devices = only ? all.filter((d) => only.includes(d.ieee_address)) : all;
  }
  private readonly states = new Map<string, Record<string, unknown>>();
  private groupList: Z2mGroup[] = [];

  connected(): boolean {
    return true;
  }
  knownDevices(): Z2mDevice[] {
    return this.devices;
  }
  deviceState(ieee: string): Record<string, unknown> | undefined {
    return this.states.get(ieee);
  }
  readonly offline = new Set<string>();
  gateway: boolean | null = true;
  gatewayOnline(): boolean | null {
    return this.gateway;
  }
  setGateway(online: boolean): void {
    this.gateway = online;
    this.publish('gateway', { online });
  }
  isOnline(ieee: string): boolean | undefined {
    return this.offline.has(ieee) ? false : true;
  }
  async refresh(ieee: string): Promise<Record<string, unknown>> {
    return this.states.get(ieee) ?? {};
  }
  lightMode(): 'color' | 'white' | null {
    return null;
  }
  readonly renames: Array<{ ieee: string; name: string }> = [];
  async rename(ieee: string, name: string): Promise<void> {
    this.renames.push({ ieee, name });
  }
  readonly interviews: string[] = [];
  async interview(ieee: string): Promise<void> {
    this.interviews.push(ieee);
  }
  readonly configured: string[] = [];
  async configure(ieee: string): Promise<void> {
    this.configured.push(ieee);
  }
  readonly left: string[] = [];
  async leave(ieee: string): Promise<void> {
    this.left.push(ieee);
  }

  async command(ieee: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
    const d = this.devices.find((x) => x.ieee_address === ieee);
    if (!d?.definition) throw new CommandError('Unknown device', 404);
    const problem = checkValues(flattenExposes(d.definition.exposes), values);
    if (problem) throw new CommandError(problem, 400);
    this.commands.push({ target: ieee, values });
    const previous = this.states.get(ieee) ?? {};
    const next = { ...previous };
    for (const [k, v] of Object.entries(values)) {
      if (k === 'transition') continue;
      next[k] = v === 'TOGGLE' ? (previous[k] === 'ON' ? 'OFF' : 'ON') : v;
    }
    this.report(ieee, next);
    return next;
  }

  /** A device reporting new values, as Zigbee2MQTT would publish them. */
  report(ieee: string, state: Record<string, unknown>): void {
    const previous = this.states.get(ieee) ?? {};
    this.states.set(ieee, state);
    const changed = Object.keys(state).filter((k) => JSON.stringify(state[k]) !== JSON.stringify(previous[k]));
    this.publish('state', { ieee, state, previous, changed });
  }

  pressButton(ieee: string, raw: string): void {
    const d = this.devices.find((x) => x.ieee_address === ieee);
    this.publish('button', { ieee, raw, ...(normalisePress(d?.definition?.model, raw) ?? {}) });
  }

  private publish<K extends keyof DeviceEvents>(event: K, payload: DeviceEvents[K]): void {
    this.emit(event, payload);
  }

  groups(): Z2mGroup[] {
    return this.groupList;
  }
  groupProperties(group: number): ExposedProperty[] {
    const m = this.groupList.find((g) => g.id === group)?.members[0];
    const d = this.devices.find((x) => x.ieee_address === m?.ieee_address);
    return d?.definition ? flattenExposes(d.definition.exposes) : [];
  }
  async createGroup(display: string, members: Array<{ ieee: string; endpoint?: number }>): Promise<Z2mGroup> {
    const g = { id: this.groupList.length + 1, friendly_name: display, members: members.map((m) => ({ ieee_address: m.ieee, endpoint: m.endpoint ?? 1 })) };
    this.groupList.push(g);
    return g;
  }
  async addGroupMember(group: number, ieee: string, endpoint = 1): Promise<void> {
    this.groupList.find((g) => g.id === group)?.members.push({ ieee_address: ieee, endpoint });
  }
  async removeGroupMember(group: number, ieee: string): Promise<void> {
    const g = this.groupList.find((x) => x.id === group);
    if (g) g.members = g.members.filter((m) => m.ieee_address !== ieee);
  }
  async removeGroup(group: number): Promise<void> {
    this.groupList = this.groupList.filter((g) => g.id !== group);
  }
  async groupCommand(group: number, values: Record<string, unknown>): Promise<void> {
    const g = this.groupList.find((x) => x.id === group);
    if (!g) throw new CommandError('Unknown group', 404);
    this.commands.push({ target: group, values });
    for (const m of g.members) await this.command(m.ieee_address, values);
  }
}
