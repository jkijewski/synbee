import type { Actions } from '../actions.js';
import type { Auth } from '../auth.js';
import type { Db } from '../db.js';
import type { Devices } from '../devices.js';
import type { LightGroups } from '../groups.js';
import type { Members } from '../members.js';
import type { GatewayWebCheck } from '../gateway-web.js';
import type { SynologyChat } from '../chat-channel.js';
import type { Checks } from '../checks.js';
import type { AlertPause } from '../alert-pause.js';
import type { SensorGroups } from '../sensor-groups.js';
import type { DeviceTiles } from '../tiles.js';
import type { GatewayLogins } from '../gateway-hardening.js';
import type { Fetch } from '../slzb.js';
import type { DependencyIndex } from '../related.js';
import type { RoomPhotos, Rooms } from '../rooms.js';
import type { RuleEngine } from '../rule-engine.js';
import type { Rules } from '../rules.js';
import type { Energy } from '../energy.js';
import type { History } from '../history.js';
import type { Notifications } from '../notifications.js';
import type { ZigbeeBridge } from '../zigbee.js';
import type { DeviceControl, GroupControl } from '../ports.js';
import type { CoordinatorBackup } from '../backup.js';
import type { Coordinator } from '../coordinator.js';
import type { discoverCoordinators, Gateway } from '../gateway.js';

// What the LAN listener's route files share (0015): the modules, built once in server.ts, and a few views over them.

/** The app listener (0021), as the members page needs it for pairing codes. */
export interface AppListener {
  port: number;
  /** The NAS's home network addresses. */
  addresses: () => string[];
  /** SHA-256 of the hub key's SubjectPublicKeyInfo, base64. */
  fingerprint: () => string;
}

/** One gateway (0023): its Zigbee2MQTT bridge, address, settings and backup. */
export interface NetworkRuntime {
  id: number;
  name: string;
  zigbee?: ZigbeeBridge;
  coordinator?: Coordinator;
  gateway?: Gateway;
  backup?: CoordinatorBackup;
}

/** Adding, renaming and removing gateways; the composition root starts and stops their bridges. */
export interface NetworkAdmin {
  add(input: { name?: unknown }): { id: number; name: string };
  rename(id: number, input: { name?: unknown }): { id: number; name: string };
  remove(id: number): void;
}

export interface InternalServerDeps {
  db: Db;
  version: string;
  /** The device router (0023) over every source; for tests, a single bridge works too. */
  zigbee?: ZigbeeBridge;
  /** Device control for the core: the router over all gateways. Defaults to `zigbee`. */
  control?: DeviceControl & GroupControl;
  /** Every gateway; without it, the single `zigbee`, `coordinator`, `gateway` and `backup` are gateway 1. */
  networks?: () => NetworkRuntime[];
  networkAdmin?: NetworkAdmin;
  actions?: Actions;
  groups?: LightGroups;
  rules?: Rules;
  engine?: RuleEngine;
  history?: History;
  energy?: Energy;
  notifications?: Notifications;
  backup?: CoordinatorBackup;
  gateway?: Gateway;
  /** Finds coordinators on the network; replaceable in tests. */
  discover?: typeof discoverCoordinators;
  coordinator?: Coordinator;
  /** Folder for room photos, in the data folder. */
  photoDir?: string;
  /** Folder with the package's logs, readable by the owner through the internal listener. */
  logDir?: string;
  /** Version of the bundled Zigbee2MQTT, from the package. */
  z2mVersion?: string;
  members?: Members;
  /** Whether the coordinator's web page asks for a login (0007). */
  gatewayWeb?: GatewayWebCheck;
  /** The owner's logins to the gateways' own web pages, for setting their protections (0007, option B). */
  gatewayLogins?: GatewayLogins;
  /** Alerts out of the hub through a Synology Chat incoming webhook. */
  chat?: SynologyChat;
  sensorGroups?: SensorGroups;
  /** Alerts paused by an app user, shown on the Notifications page. */
  alertPause?: AlertPause;
  checks?: Checks;
  /** Which devices show as status tiles in the app. */
  deviceTiles?: DeviceTiles;
  /** Replaces fetch towards gateways, in tests. */
  slzbFetch?: Fetch;
  appListener?: AppListener;
  /** The database file, for its migration copies on the Status page. */
  dbFile?: string;
  /** Where the package keeps Zigbee2MQTT snapshots taken before upgrades. */
  snapshotDir?: string;
  /** Folder with the built web UI; served at / when given. */
  webRoot?: string;
  /** Host names besides addresses and local names under which the home network opens SynBee (HUB_ALLOWED_HOSTS). */
  allowedHosts?: string[];
}

export interface RouteContext {
  db: Db;
  version: string;
  /** The Zigbee2MQTT bridge itself, for the gateway routes only: pairing, bridge info and requests (0015). */
  zigbee?: ZigbeeBridge;
  /** Devices and groups through the ports, for every other route. */
  control?: DeviceControl & GroupControl;
  deps: InternalServerDeps;
  /** The gateways, for the gateway routes. */
  networks: () => NetworkRuntime[];
  auth: Auth;
  devices: Devices;
  rooms: Rooms;
  photos: RoomPhotos | null;
  groups: LightGroups;
  actions: Actions;
  rules: Rules;
  engine: RuleEngine;
  history: History;
  energy: Energy;
  notifications: Notifications;
  members: Members;
  /** The icon shown for a device: the owner's choice, else one from its capabilities, else one from the Tuya import. */
  iconOf: (ieee: string) => { icon: string; autoIcon: string; iconChosen: boolean };
  labelsOf: (ieee: string) => Record<string, string>;
  dependencyIndex: () => DependencyIndex;
}

/** A numeric id from a URL; anything else becomes -1, which no row has. */
export const idParam = (raw: string): number => (/^\d{1,9}$/.test(raw) ? Number(raw) : -1);
