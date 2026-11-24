import type { Action } from './actions.js';
import { inUnit, temperatureUnit } from './units.js';
import type { Db } from './db.js';
import { flattenExposes, type ExposedProperty } from './exposes.js';
import { actionState, stepMatches, type ActionState, type StepMatch } from './features/action-state.js';
import { describeDevice, describeValue, type Reading } from './features/describe.js';
import { Devices } from './devices.js';
import { TRANSITION } from './features/index.js';
import { isLight, lightSummary, summaryWords } from './features/light-summary.js';
import type { LightGroups } from './groups.js';
import type { DeviceControl } from './ports.js';
import type { Rooms } from './rooms.js';

// Read models over device states (0008, 0011): a device or light group in words, and whether an action's devices
// show what it sets. For the app and the web interface; nothing here changes a device.

export interface DeviceView {
  ieee: string;
  name: string;
  room: string | null;
  online: boolean | null;
  /** "On · red · 30 %", "21.4 °C · 48 %", or empty when nothing is known. */
  summary: string;
  readings: Reading[];
  battery: number | null;
  /** When the device was last heard from, when Zigbee2MQTT reports it. */
  lastSeen: string | null;
}

export class DeviceViews {
  constructor(
    private readonly db: Db,
    private readonly control: DeviceControl | undefined,
    private readonly groups: LightGroups,
    private readonly rooms: Rooms,
  ) {}

  propsOf(ieee: string): ExposedProperty[] {
    const z = this.control?.knownDevices().find((d) => d.ieee_address.toLowerCase() === ieee);
    return flattenExposes(z?.definition?.exposes);
  }

  device(ieee: string): DeviceView {
    const state = this.control?.deviceState(ieee) ?? {};
    const { summary, readings } = describeDevice(this.propsOf(ieee), state, this.control?.lightMode(ieee) ?? null, new Devices(this.db).labels(ieee));
    const row = this.db.prepare('SELECT d.name, r.name AS room FROM devices d LEFT JOIN rooms r ON r.id = d.room_id WHERE d.ieee = ?').get(ieee) as
      | { name: string; room: string | null }
      | undefined;
    const seen = state.last_seen;
    // Temperatures in the owner's unit (devices report Celsius).
    const unit = temperatureUnit(this.db);
    return {
      ieee,
      name: row?.name ?? ieee,
      room: row?.room ?? null,
      online: this.control?.isOnline(ieee) ?? null,
      summary: inUnit(summary, unit),
      readings: readings.map((r) => ({ ...r, text: inUnit(r.text, unit) })),
      battery: typeof state.battery === 'number' ? state.battery : null,
      lastSeen: typeof seen === 'string' ? seen : typeof seen === 'number' ? new Date(seen).toISOString() : null,
    };
  }

  /** A device's raw value of one property, as it reported it. */
  value(ieee: string, property: string): unknown {
    return this.control?.deviceState(ieee)?.[property];
  }

  /** The devices of a room (main room and "also shown here"), lights first, then switches, sensors and the rest. */
  room(roomId: number): DeviceView[] {
    const room = this.rooms.list().find((r) => r.id === roomId);
    if (!room) return [];
    const rank = (ieee: string) => {
      const props = this.propsOf(ieee);
      if (isLight(props)) return 0;
      if (props.some((p) => p.property.startsWith('state') && p.writable)) return 1;
      if (props.some((p) => !p.writable && !p.category)) return 2;
      return 3;
    };
    return [...room.devices, ...room.alsoDevices]
      .map((ieee) => ({ ieee, rank: rank(ieee) }))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => this.device(x.ieee));
  }

  /** What a light group's lights show: "Off", the one look they share, or how many are on; null when unknown. */
  groupWords(groupId: number): string | null {
    const members = this.groups.get(groupId)?.members ?? [];
    if (!this.control || members.length === 0) return null;
    const words = members.map((m) => {
      const props = this.propsOf(m.ieee);
      return isLight(props) ? summaryWords(lightSummary(props, this.control!.deviceState(m.ieee) ?? {}, this.control!.lightMode(m.ieee))) : '';
    });
    if (words.some((w) => w === '')) return null;
    if (words.every((w) => w === words[0])) return words[0]!;
    const on = words.filter((w) => w !== 'Off').length;
    return on === 0 ? 'Off' : `${on} of ${words.length} on`;
  }

  private matchDevice(ieee: string, values: Record<string, unknown>): StepMatch {
    const state = this.control?.deviceState(ieee);
    // What the hub knows the light shows; after a restart, what the light last reported.
    const reported = state?.color_mode === 'color_temp' ? 'white' : state?.color_mode === 'hs' || state?.color_mode === 'xy' ? 'color' : null;
    return stepMatches(this.propsOf(ieee), values, state, this.control?.lightMode(ieee) ?? reported);
  }

  /**
   * What the action leaves each device showing: its steps' values merged in order, a group's for each member. An
   * action that passes through a colour on its way ("hue 6, 36 %", then "on", then "red, 100 %") ends at the last.
   */
  private finalValues(action: Action): Map<string, Record<string, unknown>> | null {
    const out = new Map<string, Record<string, unknown>>();
    for (const s of action.steps) {
      const ieees = s.kind === 'device' ? [s.device] : (this.groups.get(s.group)?.members ?? []).map((m) => m.ieee);
      if (ieees.length === 0) return null;
      for (const ieee of ieees) {
        const values = { ...(out.get(ieee) ?? {}), ...s.values };
        delete values[TRANSITION];
        out.set(ieee, values);
      }
    }
    return out;
  }

  /** Whether the action's devices show what it leaves them showing: all, some or none of them; null when unknown. */
  actionState(action: Action): ActionState | null {
    const finals = this.finalValues(action);
    if (!finals) return null;
    return actionState([...finals].map(([ieee, values]) => this.matchDevice(ieee, values)));
  }

  /**
   * Whether what the action switches is on: all, some or none of it, for the tile's colour; null when unknown. A step
   * on one channel (state_l1) looks at that channel; light settings and light groups at the lights' state.
   */
  actionPower(action: Action): 'on' | 'partly' | 'off' | null {
    const ons: boolean[] = [];
    const isOn = (ieee: string, key: string): boolean | null => {
      const prop = this.propsOf(ieee).find((p) => p.property === key);
      const value = this.control?.deviceState(ieee)?.[key];
      if (value === undefined) return null;
      return String(value).toUpperCase() === String(prop?.valueOn ?? 'ON').toUpperCase();
    };
    for (const s of action.steps) {
      const stateKeys = Object.keys(s.values).filter((k) => k === 'state' || k.startsWith('state_'));
      const keys = stateKeys.length ? stateKeys : ['state'];
      const ieees = s.kind === 'device' ? [s.device] : (this.groups.get(s.group)?.members ?? []).map((m) => m.ieee);
      for (const ieee of ieees) for (const k of keys) {
        const on = isOn(ieee, k);
        if (on !== null) ons.push(on);
      }
    }
    if (ons.length === 0) return null;
    return ons.every(Boolean) ? 'on' : ons.some(Boolean) ? 'partly' : 'off';
  }

  /**
   * The tile's colour (0011), by the kind of action: a scene (it sets colour, white or brightness) is "on" only while
   * its devices show that scene, so of several scenes on the same lights only the showing one is coloured; a plain "on"
   * action is "on" while what it switches is on; an "off" action is never coloured (its check says it's done).
   */
  tileLook(action: Action): 'on' | 'partly' | 'off' | null {
    const keys = action.steps.flatMap((s) => Object.keys(s.values).filter((k) => k !== TRANSITION));
    const stateValues = action.steps.flatMap((s) => Object.entries(s.values).filter(([k]) => k === 'state' || k.startsWith('state_')).map(([, v]) => String(v).toUpperCase()));
    const onlyState = keys.every((k) => k === 'state' || k.startsWith('state_'));
    if (onlyState && stateValues.length > 0 && stateValues.every((v) => v === 'OFF')) return 'off';
    if (onlyState) return this.actionPower(action);
    // A scene is coloured only when every device shows it; anything less is just not this scene.
    const state = this.actionState(action);
    return state === null ? null : state === 'active' ? 'on' : 'off';
  }

  /** The tile's line: what the owner chose, or worked out from what the action switches. Empty when unknown. */
  actionStatus(action: Action): string {
    const tile = action.tile;
    if (tile.show === 'none') return '';
    if (tile.show === 'group') return this.groupWords(tile.group) ?? '';
    if (tile.show === 'device') {
      const prop = this.propsOf(tile.device).find((p) => p.property === tile.property);
      const value = this.control?.deviceState(tile.device)?.[tile.property];
      return prop ? (describeValue(prop, value) ?? '') : '';
    }
    const parts = action.steps.map((s) => (s.kind === 'group' ? this.groupWords(s.group) : this.stepWords(s.device, s.values)));
    if (parts.length === 1) return parts[0] ?? '';
    if (parts.some((p) => p === null)) return '';
    const on = parts.filter((p) => p !== 'Off').length;
    return on === 0 ? 'Off' : on === parts.length && parts.every((p) => p === parts[0]) ? parts[0]! : `${on} of ${parts.length} on`;
  }

  /**
   * What one device step's values look like now: a light's look, or the values the step sets in words (one channel of
   * a multi-channel switch is "Off", not the whole device). Null when unknown.
   */
  private stepWords(ieee: string, values: Record<string, unknown>): string | null {
    const props = this.propsOf(ieee);
    const keys = Object.keys(values).filter((k) => k !== TRANSITION);
    if (isLight(props) && keys.every((k) => props.some((p) => p.property === k && !p.endpoint))) return this.device(ieee).summary || null;
    const state = this.control?.deviceState(ieee) ?? {};
    const words = keys.map((k) => {
      const prop = props.find((p) => p.property === k);
      return prop ? describeValue(prop, state[k]) : null;
    });
    return words.some((w) => w === null) ? null : words.join(' · ');
  }

  /** What an action touches, for the app's details sheet: each device, and each group with its devices. */
  actionTargets(action: Action): Array<{ kind: 'device'; device: DeviceView } | { kind: 'group'; name: string; summary: string; devices: DeviceView[] }> {
    return action.steps.map((s) => {
      if (s.kind === 'device') return { kind: 'device' as const, device: this.device(s.device) };
      const g = this.groups.get(s.group);
      return { kind: 'group' as const, name: g?.name ?? `Group ${s.group}`, summary: this.groupWords(s.group) ?? '', devices: (g?.members ?? []).map((m) => this.device(m.ieee)) };
    });
  }
}
