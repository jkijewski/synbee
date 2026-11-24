import type { ButtonPress } from './buttons.js';
import type { ExposedProperty } from './exposes.js';
import type { LightMode } from './features/light-summary.js';

// Ports (0015): what the hub's modules need from the world of devices, as interfaces. The Zigbee2MQTT bridge
// (zigbee.ts) implements them over MQTT; tests can pass a fake; later device sources would implement them too.
// Modules depend on these, never on the bridge class.

/** A device as Zigbee2MQTT describes it. */
export interface Z2mDevice {
  ieee_address: string;
  friendly_name: string;
  type: string;
  supported: boolean;
  interview_completed?: boolean;
  definition: { model: string; vendor: string; description: string; exposes: unknown[]; options: unknown[] } | null;
  model_id?: string;
  manufacturer?: string;
}

/** A Zigbee group as Zigbee2MQTT describes it. */
export interface Z2mGroup {
  id: number;
  friendly_name: string;
  members: Array<{ ieee_address: string; endpoint: number }>;
}

/** A command the devices refused or that could not be confirmed, with an HTTP-like status. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Events about devices, delivered in-process. */
export interface DeviceEvents {
  /** A device reported values; `changed` lists the properties that differ from before. */
  state: { ieee: string; state: Record<string, unknown>; previous: Record<string, unknown>; changed: string[] };
  /** A remote's button was pressed; `button` and `press` are set when the value maps to them. */
  button: { ieee: string; raw: unknown } & Partial<ButtonPress>;
  availability: { ieee: string; online: boolean };
  'device-joined': { ieee: string; name: string; imported: boolean };
  /** Zigbee2MQTT, and through it the gateway, came online or went offline. */
  gateway: { online: boolean; /** Which gateway (device source), when there are several (0023). */ source?: number };
}

/** A typed event channel: listeners get exactly the payload of the event they subscribe to. */
export interface EventSource<E> {
  on<K extends keyof E & string>(event: K, listener: (payload: E[K]) => void): unknown;
  off<K extends keyof E & string>(event: K, listener: (payload: E[K]) => void): unknown;
}

/** Reading and controlling single devices, and their events. */
export interface DeviceControl extends EventSource<DeviceEvents> {
  connected(): boolean;
  knownDevices(): Z2mDevice[];
  deviceState(ieee: string): Record<string, unknown> | undefined;
  /** Sets values and resolves with the confirmed state; rejects with CommandError. */
  command(ieee: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** True or false once availability is known, otherwise undefined. */
  isOnline(ieee: string): boolean | undefined;
  /** Whether Zigbee2MQTT is running and connected to the gateway; null until it has said. */
  gatewayOnline(): boolean | null;
  /** Asks the device for its current values of these properties (those it can be asked for); resolves with its state. */
  refresh(ieee: string, properties: string[]): Promise<Record<string, unknown>>;
  /** Whether a light shows colour or white, as far as the hub knows; null when unknown. */
  lightMode(ieee: string): LightMode | null;
  /** Gives the device a new name in the radio layer, derived from the name the owner sees. */
  rename(ieee: string, displayName: string): Promise<void>;
  /** Reads a joined device's details again, for one that wasn't recognised or fully read when it joined. */
  interview(ieee: string): Promise<void>;
  /** Sets up a device's reporting again (after a gateway replacement, or when it stopped reporting changes). */
  configure(ieee: string): Promise<void>;
  /** Asks a joined device to leave the network (not forced), so it looks for a network again. */
  leave(ieee: string): Promise<void>;
}

/** Zigbee groups: one broadcast switches every member. */
export interface GroupControl {
  connected(): boolean;
  groups(): Z2mGroup[];
  /** Properties a group can be set to. */
  groupProperties(group: number): ExposedProperty[];
  createGroup(display: string, members: Array<{ ieee: string; endpoint?: number }>): Promise<Z2mGroup>;
  addGroupMember(group: number, ieee: string, endpoint?: number): Promise<void>;
  removeGroupMember(group: number, ieee: string, endpoint?: number): Promise<void>;
  removeGroup(group: number): Promise<void>;
  groupCommand(group: number, values: Record<string, unknown>): Promise<void>;
}
