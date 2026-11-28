import type { Db } from './db.js';
import { Devices } from './devices.js';
import type { Action } from './actions.js';
import type { Condition, Rule } from './rules.js';
import type { LightGroup } from './groups.js';
import type { Check } from './checks.js';
import type { SensorGroup } from './sensor-groups.js';

// One dependency index over devices, light groups, actions and rules (0013). Every "Related" list and every
// "this is used by" warning is read from it, so they always agree. Sensor groups and checks (0024) aren't items
// of their own here: a trigger or condition on one counts as an indirect use of the devices behind it, and the
// room it shows in counts for room membership.

export type Role = 'trigger' | 'condition' | 'target' | 'member';
export interface Link {
  role: Role;
  /** Set for an indirect link, such as "light group Living room lights" or "action Desk spot". */
  via?: string;
}
export interface RelatedDevice {
  ieee: string;
  name: string;
  links: Link[];
}
export interface RelatedAction {
  id: number;
  name: string;
  draft: boolean;
  links: Link[];
}
export interface RelatedRule {
  id: number;
  name: string;
  enabled: boolean;
  draft: boolean;
  links: Link[];
}
export interface RelatedGroup {
  id: number;
  name: string;
  links: Link[];
}
export interface Related {
  devices: RelatedDevice[];
  groups: RelatedGroup[];
  actions: RelatedAction[];
  rules: RelatedRule[];
}

export interface IndexInput {
  devices: Array<{ ieee: string; name: string }>;
  groups: Array<Pick<LightGroup, 'id' | 'name' | 'members' | 'plannedMembers' | 'created'>>;
  actions: Action[];
  rules: Rule[];
  sensorGroups?: Array<Pick<SensorGroup, 'id' | 'name' | 'roomId' | 'members'>>;
  checks?: Array<Pick<Check, 'id' | 'name' | 'roomId' | 'if'>>;
}

type Key = string; // "device:0x…", "group:1", "action:2", "rule:3"
interface Edge {
  from: Key; // the user: an action or rule, or a group for its members
  to: Key; // what it uses
  role: Role;
  via?: string;
}

const dev = (ieee: string): Key => `device:${ieee}`;
const grp = (id: number): Key => `group:${id}`;
const act = (id: number): Key => `action:${id}`;
const rul = (id: number): Key => `rule:${id}`;

export class DependencyIndex {
  private readonly edges: Edge[] = [];
  private readonly names = new Map<Key, string>();
  private readonly input: IndexInput;
  /** Rooms an action or rule is in through the sensor groups and checks it uses, keyed "action:1" / "rule:2". */
  private readonly ownRooms = new Map<Key, Set<number>>();

  constructor(input: IndexInput) {
    this.input = input;
    for (const d of input.devices) this.names.set(dev(d.ieee), d.name);
    for (const g of input.groups) this.names.set(grp(g.id), g.name);
    for (const a of input.actions) this.names.set(act(a.id), a.name);
    for (const r of input.rules) this.names.set(rul(r.id), r.name);

    // Direct uses.
    for (const g of input.groups) {
      const members = g.created ? g.members : g.plannedMembers;
      for (const m of members) this.edges.push({ from: grp(g.id), to: dev(m.ieee), role: 'member' });
    }
    for (const a of input.actions) {
      for (const st of a.steps) {
        if (st.kind === 'device') this.edges.push({ from: act(a.id), to: dev(st.device), role: 'target' });
        if (st.kind === 'group') this.edges.push({ from: act(a.id), to: grp(st.group), role: 'target' });
      }
    }
    // A sensor group or check stands for the devices behind it: indirect links, never "used by" for deleting.
    const sensorGroup = (from: Key, id: number, role: Role, via: string) => {
      const sg = input.sensorGroups?.find((x) => x.id === id);
      if (!sg) return;
      if (sg.roomId != null) this.addRoom(from, sg.roomId);
      for (const m of sg.members) this.edges.push({ from, to: dev(m.ieee), role, via: `${via}sensor group ${sg.name}` });
    };
    const check = (from: Key, id: number, role: Role) => {
      const ck = input.checks?.find((x) => x.id === id);
      if (!ck) return;
      if (ck.roomId != null) this.addRoom(from, ck.roomId);
      const via = `check ${ck.name}`;
      for (const c of ck.if.conditions) {
        if (c.type === 'state') this.edges.push({ from, to: dev(c.device), role, via });
        if (c.type === 'group') {
          const g = input.groups.find((x) => x.id === c.group);
          for (const m of g ? (g.created ? g.members : g.plannedMembers) : []) this.edges.push({ from, to: dev(m.ieee), role, via: `${via}, light group ${g!.name}` });
        }
        if (c.type === 'sensors') sensorGroup(from, c.group, role, `${via}, `);
      }
    };
    const usesCondition = (from: Key, c: Condition | undefined) => {
      if (c?.type === 'state') this.edges.push({ from, to: dev(c.device), role: 'condition' });
      if (c?.type === 'group') this.edges.push({ from, to: grp(c.group), role: 'condition' });
      if (c?.type === 'sensors') sensorGroup(from, c.group, 'condition', '');
      if (c?.type === 'check') check(from, c.check, 'condition');
    };
    const condition = (r: Rule, c: Condition | undefined) => usesCondition(rul(r.id), c);
    for (const a of input.actions) a.if?.conditions.forEach((c) => usesCondition(act(a.id), c));
    for (const r of input.rules) {
      for (const t of r.when) {
        if (t.type === 'button' || t.type === 'state') this.edges.push({ from: rul(r.id), to: dev(t.device), role: 'trigger' });
        if (t.type === 'action') this.edges.push({ from: rul(r.id), to: act(t.action), role: 'trigger' });
        if (t.type === 'sensors') sensorGroup(rul(r.id), t.group, 'trigger', '');
        if (t.type === 'check') check(rul(r.id), t.check, 'trigger');
      }
      r.if.conditions.forEach((c) => condition(r, c));
      for (const step of r.then) {
        condition(r, step.onlyIf);
        const s = step.type === 'later' ? step.step : step;
        if (s.type === 'device') this.edges.push({ from: rul(r.id), to: dev(s.device), role: 'target' });
        if (s.type === 'group') this.edges.push({ from: rul(r.id), to: grp(s.group), role: 'target' });
        if (s.type === 'action') this.edges.push({ from: rul(r.id), to: act(s.action), role: 'target' });
      }
    }

    // Indirect uses: through a light group's members, and through the actions a rule runs or starts on.
    const direct = [...this.edges];
    for (const e of direct) {
      if (e.from.startsWith('group:')) continue;
      if (e.to.startsWith('group:')) {
        for (const m of direct.filter((x) => x.from === e.to)) this.edges.push({ from: e.from, to: m.to, role: e.role, via: `light group ${this.names.get(e.to) ?? e.to}` });
      }
      if (e.from.startsWith('rule:') && e.to.startsWith('action:')) {
        const viaAction = `action ${this.names.get(e.to) ?? e.to}`;
        for (const x of direct.filter((y) => y.from === e.to)) {
          if (x.to.startsWith('group:')) {
            this.edges.push({ from: e.from, to: x.to, role: e.role, via: viaAction });
            for (const m of direct.filter((y) => y.from === x.to)) this.edges.push({ from: e.from, to: m.to, role: e.role, via: `${viaAction}, light group ${this.names.get(x.to)}` });
          } else this.edges.push({ from: e.from, to: x.to, role: e.role, via: viaAction });
        }
      }
    }
  }

  private addRoom(from: Key, room: number) {
    const set = this.ownRooms.get(from) ?? new Set<number>();
    set.add(room);
    this.ownRooms.set(from, set);
  }

  /** What is related to one device, group, action or rule, in both directions. */
  related(kind: 'device' | 'group' | 'action' | 'rule', id: string | number): Related {
    const key = `${kind}:${id}`;
    const out = new Map<Key, Link[]>();
    const add = (k: Key, link: Link) => {
      const list = out.get(k) ?? [];
      if (!list.some((l) => l.role === link.role && l.via === link.via)) list.push(link);
      out.set(k, list);
    };
    for (const e of this.edges) {
      // Something that uses this item: an action or rule using a device, or a group holding it.
      if (e.to === key) add(e.from, { role: e.role, ...(e.via ? { via: e.via } : {}) });
      // Something this item uses.
      if (e.from === key) add(e.to, { role: e.role, ...(e.via ? { via: e.via } : {}) });
    }
    out.delete(key);
    const pick = <T>(prefix: string, make: (id: string, links: Link[]) => T | null) =>
      [...out.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, links]) => make(k.slice(prefix.length), links))
        .filter((x): x is T => x !== null);
    const byName = <T extends { name: string }>(list: T[]) => list.sort((a, b) => a.name.localeCompare(b.name));
    return {
      devices: byName(pick('device:', (ieee, links) => ({ ieee, name: this.names.get(dev(ieee)) ?? ieee, links }))),
      groups: byName(pick('group:', (id, links) => ({ id: Number(id), name: this.names.get(grp(Number(id))) ?? id, links }))),
      actions: byName(
        pick('action:', (id, links) => {
          const a = this.input.actions.find((x) => x.id === Number(id));
          return a ? { id: a.id, name: a.name, draft: a.draft, links } : null;
        }),
      ),
      rules: byName(
        pick('rule:', (id, links) => {
          const r = this.input.rules.find((x) => x.id === Number(id));
          return r ? { id: r.id, name: r.name, enabled: r.enabled, draft: r.draft, links } : null;
        }),
      ),
    };
  }

  /**
   * Actions and rules that use any of these devices (a room's devices), directly or indirectly, with the devices
   * they go through.
   */
  forDevices(ieees: string[]): {
    groups: Array<{ id: number; name: string; devices: string[] }>;
    actions: Array<{ id: number; name: string; draft: boolean; devices: string[] }>;
    rules: Array<{ id: number; name: string; enabled: boolean; draft: boolean; devices: string[] }>;
  } {
    const groups = new Map<number, { id: number; name: string; devices: string[] }>();
    const actions = new Map<number, { id: number; name: string; draft: boolean; devices: string[] }>();
    const rules = new Map<number, { id: number; name: string; enabled: boolean; draft: boolean; devices: string[] }>();
    for (const ieee of ieees) {
      const name = this.names.get(dev(ieee)) ?? ieee;
      const r = this.related('device', ieee);
      for (const g of r.groups) {
        const e = groups.get(g.id) ?? { id: g.id, name: g.name, devices: [] };
        if (!e.devices.includes(name)) e.devices.push(name);
        groups.set(g.id, e);
      }
      for (const a of r.actions) {
        const e = actions.get(a.id) ?? { id: a.id, name: a.name, draft: a.draft, devices: [] };
        if (!e.devices.includes(name)) e.devices.push(name);
        actions.set(a.id, e);
      }
      for (const x of r.rules) {
        const e = rules.get(x.id) ?? { id: x.id, name: x.name, enabled: x.enabled, draft: x.draft, devices: [] };
        if (!e.devices.includes(name)) e.devices.push(name);
        rules.set(x.id, e);
      }
    }
    const byName = <T extends { name: string }>(l: T[]) => l.sort((a, b) => a.name.localeCompare(b.name));
    return { groups: byName([...groups.values()]), actions: byName([...actions.values()]), rules: byName([...rules.values()]) };
  }

  /**
   * Which rooms each action, rule and light group belongs to: the rooms of the devices it uses (0012), directly or
   * through a light group, sensor group, check or action, plus the rooms its sensor groups and checks show in. They
   * aren't placed in rooms themselves; what they use decides.
   */
  roomMembership(rooms: Array<{ id: number; devices: string[]; alsoDevices: string[] }>): {
    actions: Record<number, number[]>;
    rules: Record<number, number[]>;
    groups: Record<number, number[]>;
  } {
    const actions: Record<number, number[]> = {};
    const rules: Record<number, number[]> = {};
    const groups: Record<number, number[]> = {};
    for (const room of rooms) {
      const r = this.forDevices([...room.devices, ...room.alsoDevices]);
      for (const g of r.groups) (groups[g.id] ??= []).push(room.id);
      for (const a of r.actions) (actions[a.id] ??= []).push(room.id);
      for (const x of r.rules) (rules[x.id] ??= []).push(room.id);
    }
    const known = new Set(rooms.map((r) => r.id));
    for (const [key, ids] of this.ownRooms) {
      const [kind, id] = key.split(':');
      const into = kind === 'rule' ? rules : actions;
      const list = (into[Number(id)] ??= []);
      for (const room of ids) if (known.has(room) && !list.includes(room)) list.push(room);
    }
    return { actions, rules, groups };
  }

  /** The actions, rules and groups that would break if this item were deleted. */
  usedBy(kind: 'device' | 'group' | 'action', id: string | number): Related {
    const r = this.related(kind, id);
    const key = `${kind}:${id}`;
    const users = new Set(this.edges.filter((e) => e.to === key && !e.via).map((e) => e.from));
    return {
      devices: [],
      groups: r.groups.filter((g) => users.has(grp(g.id))),
      actions: r.actions.filter((a) => users.has(act(a.id))),
      rules: r.rules.filter((x) => users.has(rul(x.id))),
    };
  }
}

export function loadIndexInput(
  db: Db,
  deps: { actions: Action[]; rules: Rule[]; groups: IndexInput['groups']; sensorGroups?: IndexInput['sensorGroups']; checks?: IndexInput['checks'] },
): IndexInput {
  return {
    devices: [...new Devices(db).names()].map(([ieee, name]) => ({ ieee, name })),
    ...deps,
  };
}
