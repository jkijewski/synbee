import { featureFor } from '../../src/features/index.js';
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** A question the hub wants answered before it does this, such as unlocking a door (0008). */
    readonly confirm?: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; confirm?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.confirm);
  return data as T;
}

import type { LightSummary } from '../../src/features/light-summary.js';

export interface DeviceRow {
  ieee: string;
  name: string;
  room: string | null;
  status: 'pending' | 'joined';
  source: 'tuya-import' | 'paired';
  online?: boolean | null;
  labels?: Record<string, string>;
  icon?: string;
  autoIcon?: string;
  iconChosen?: boolean;
  roomId?: number | null;
  alsoRooms?: number[];
  /** Timer steps counting down that will set this device (0010). */
  timers?: Array<{ ruleId: number; rule: string; step: number; dueAt: number; what: string }>;
  /** A light's look; null for other devices (0008). */
  light?: LightSummary | null;
}

export interface Room {
  id: number;
  name: string;
  icon: string;
  order: number;
  color: string | null;
  photo: number | null;
  devices: string[];
  alsoDevices: string[];
}

export interface ButtonEvent {
  raw: string;
  button?: number;
  press?: 'single_click' | 'double_click' | 'long_press';
}

export interface Property {
  property: string;
  name: string;
  type: string;
  readable: boolean;
  writable: boolean;
  values?: string[];
  valueOn?: unknown;
  valueOff?: unknown;
  valueToggle?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  endpoint?: string;
  category?: 'config' | 'diagnostic';
  step?: number;
  gettable?: boolean;
}

export interface DeviceDetail extends DeviceRow {
  recognised: boolean;
  supported: boolean | null;
  model: string | null;
  vendor: string | null;
  properties: Property[];
  events: ButtonEvent[];
  state: Record<string, unknown>;
  online: boolean | null;
  labels: Record<string, string>;
  raw: { modelId: string | null; manufacturer: string | null; interviewCompleted: boolean | null } | null;
}

export interface ImportResult {
  imported: Array<{ ieee: string; name: string }>;
  updated: Array<{ ieee: string; name: string }>;
  skipped: Array<{ name: string; reason: string }>;
  rooms?: string[];
  groups?: Array<{ name: string; note: string }>;
  labels?: Array<{ device: string; endpoint: string; label: string }>;
  actions?: Array<{ name: string; notes: string }>;
  rules?: Array<{ name: string; notes: string }>;
  notImported?: Array<{ name: string; reason: string }>;
  settings?: Array<{ device: string; setting: string; value: string }>;
}

export type Step =
  | { kind: 'device'; device: string; values: Record<string, unknown> }
  | { kind: 'group'; group: number; values: Record<string, unknown> };

export interface Readiness {
  ready: boolean;
  missing: string[];
}

export interface ChoiceDevice {
  ieee: string;
  name: string;
  icon: string;
  room: string | null;
  status: 'pending' | 'joined';
  labels: Record<string, string>;
  events: ButtonEvent[];
  properties: Property[];
  /** Whether a fade can go with its light settings; false for e.g. Skydance WZ5 controllers. */
  fades?: boolean;
}

export interface Choices {
  devices: ChoiceDevice[];
  groups: Array<{ id: number; name: string; created: boolean; properties: Property[]; fades?: boolean }>;
  actions: Array<{ id: number; name: string }>;
}

export interface LightGroup {
  id: number;
  name: string;
  created: boolean;
  z2mName: string | null;
  members: Array<{ ieee: string; endpoint?: number; name?: string }>;
  plannedMembers: Array<{ ieee: string; name?: string }>;
  note: string;
  properties: Property[];
  /** What the group's lights show, e.g. "Off" or "2 of 3 on" (0008). */
  light?: string | null;
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Trigger =
  | { type: 'button'; device: string; button?: number; press?: string; raw?: string }
  | { type: 'state'; device: string; property: string; to?: unknown; above?: number; below?: number; forMinutes?: number }
  | { type: 'time'; at: string; days: Weekday[]; random?: number }
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offset: number; days: Weekday[]; random?: number }
  | { type: 'every'; minutes: number }
  | { type: 'action'; action: number }
  | { type: 'event'; name: string };
export type Condition =
  | { type: 'state'; device: string; property: string; op: 'eq' | 'ne' | 'gt' | 'lt' | 'between'; value: unknown; forMinutes?: number }
  | { type: 'time'; from: string; to: string }
  | { type: 'days'; days: Weekday[] }
  | { type: 'sun'; is: 'dark' | 'light' }
  | { type: 'group'; group: number; is: 'off' | 'partly' | 'on' };
export type TimedStep = { type: 'device'; device: string; values: Record<string, unknown> } | { type: 'group'; group: number; values: Record<string, unknown> };
export type RuleStep = (
  | { type: 'device'; device: string; values: Record<string, unknown> }
  | { type: 'group'; group: number; values: Record<string, unknown> }
  | { type: 'wait'; seconds: number }
  | { type: 'action'; action: number }
  | { type: 'event'; name: string }
  | { type: 'notify'; text: string; level: 'info' | 'warning' | 'alarm' }
  | { type: 'later'; minutes: number; step: TimedStep }
) & { onlyIf?: Condition; stop?: boolean };

export interface RuleRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  test: boolean;
  outcome: 'running' | 'completed' | 'skipped' | 'failed' | 'stopped' | 'ignored' | 'interrupted';
  reason: string;
  steps: Array<{ step: number; what: string; status: string; reason?: string }>;
  conditions: Array<{ condition: string; met: boolean; actual?: unknown }>;
}

export interface Rule {
  id?: number;
  name: string;
  enabled: boolean;
  draft: boolean;
  notes: string;
  when: Trigger[];
  if: { mode: 'all' | 'any'; conditions: Condition[] };
  then: RuleStep[];
  warnings?: string[];
  readiness?: Readiness;
  running?: boolean;
  lastRun?: RuleRun | null;
  /** "For N minutes" timers waiting to run this rule (0014). */
  waiting?: Array<{ slot: string; dueAt: number }>;
  /** Timer steps counting down (0010). */
  timers?: Array<{ step: number; dueAt: number; what: string }>;
}

export interface Action {
  id: number;
  name: string;
  icon: string;
  description: string;
  order: number;
  draft: boolean;
  notes: string;
  steps: Step[];
  /** What the action's tile shows in the app (0011). */
  tile?: TileShow;
  readiness?: Readiness;
}

export type TileShow = { show: 'auto' } | { show: 'none' } | { show: 'device'; device: string; property: string } | { show: 'group'; group: number };

export interface RunResult {
  ok: boolean;
  failedStep?: number;
  error?: string;
}

/** A device property's display name, using the channel label when there is one. */
export function propertyLabel(p: Pick<Property, 'property' | 'name' | 'endpoint' | 'type'>, labels: Record<string, string> = {}): string {
  // The channel's own name first, then the feature's label (Brightness, White temperature…), then Zigbee2MQTT's name.
  const f = featureFor(p as Property);
  const generic = ['binary', 'numeric', 'enum', 'other'].includes(f.id);
  const base = generic ? p.name.replace(/_/g, ' ') : f.label;
  if (p.endpoint && labels[p.endpoint]) return `${labels[p.endpoint]} (${p.endpoint})`;
  return p.endpoint ? `${base} (${p.endpoint})` : base;
}

/** The values a property can be set to, for dropdowns. */
export function valueChoices(p: Property): unknown[] {
  if (p.type === 'binary') return [p.valueOn, p.valueOff, p.valueToggle].filter((v) => v !== undefined);
  return p.values ?? [];
}

export interface MemberPhone {
  id: string;
  name: string;
  pairedAt: string;
  lastUsedAt: string | null;
  /** May use the app away from home (0021). */
  outside: boolean;
}

export interface Member {
  id: number;
  name: string;
  revokedActions: number[];
  revokedRooms: number[];
  devicesWithoutRoom: boolean;
  phones: MemberPhone[];
  pairingUntil: number | null;
}

export interface MembersView {
  members: Member[];
  /** The app listener, when it runs: its port, the NAS's home addresses and the hub key's fingerprint. */
  app: { port: number; addresses: string[]; fingerprint: string } | null;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
  addresses: string[];
  /** The outside address and port, when the app may be used away from home. */
  outside: string[];
  fingerprint: string;
  qr: string;
}

/** The hub key's fingerprint as the app shows it when pairing by typed code: 16 hex digits in groups of four. */
export function shortFingerprint(base64: string): string {
  try {
    const hex = Array.from(atob(base64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.slice(0, 16).match(/.{4}/g)!.join(' ');
  } catch {
    return '';
  }
}

/** A gateway API path for one gateway (0023): ?network=n, left out for the first. */
export const onGateway = (url: string, network = 1): string => (network === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}network=${network}`);

export interface GatewaySummary {
  id: number;
  name: string;
  address: string;
  connected: boolean;
  devices: number;
  settings: { adapter: string; rtscts: boolean; channel: number } | null;
}
