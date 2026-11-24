import type { Db } from './db.js';
import { Devices } from './devices.js';
import type { ExposedProperty } from './exposes.js';
import { CommandError, type GroupControl } from './ports.js';

// Light groups: Zigbee2MQTT groups with a display name in the hub. A group imported from Tuya exists in the hub before
// its bulbs have moved; it is created in Zigbee2MQTT once its members have joined.

export interface GroupMember {
  ieee: string;
  endpoint?: number;
  name?: string;
}

export interface LightGroup {
  id: number;
  name: string;
  /** False until the group exists in Zigbee2MQTT. */
  created: boolean;
  z2mName: string | null;
  members: GroupMember[];
  note: string;
  /** Devices an imported group probably holds, to offer when it is created. */
  plannedMembers: GroupMember[];
  properties: ExposedProperty[];
}

const IEEE = /^0x[0-9a-f]{16}$/;

export class GroupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name || name.length > 60) throw new GroupError('Name must be 1 to 60 characters');
  return name;
}

function cleanMembers(raw: unknown): Array<{ ieee: string; endpoint?: number }> {
  if (!Array.isArray(raw) || raw.length > 50) throw new GroupError('Choose up to 50 devices');
  return raw.map((m, i) => {
    const r = (typeof m === 'string' ? { ieee: m } : (m ?? {})) as Record<string, unknown>;
    const ieee = typeof r.ieee === 'string' ? r.ieee.toLowerCase() : '';
    if (!IEEE.test(ieee)) throw new GroupError(`Member ${i + 1}: choose a device`);
    if (r.endpoint !== undefined && (!Number.isInteger(r.endpoint) || (r.endpoint as number) < 1 || (r.endpoint as number) > 240)) {
      throw new GroupError(`Member ${i + 1}: endpoint must be 1 to 240`);
    }
    return { ieee, ...(r.endpoint !== undefined ? { endpoint: r.endpoint as number } : {}) };
  });
}

export class LightGroups {
  constructor(
    private readonly db: Db,
    private readonly zigbee?: GroupControl,
  ) {}

  list(): LightGroup[] {
    const rows = this.db.prepare('SELECT id, name, z2m_id, note, planned_members FROM light_groups ORDER BY name').all() as Array<{
      id: number;
      name: string;
      z2m_id: number | null;
      note: string;
      planned_members: string;
    }>;
    const names = new Devices(this.db).names();
    return rows.map((r) => {
      const z = r.z2m_id !== null ? this.zigbee?.groups().find((g) => g.id === r.z2m_id) : undefined;
      return {
        id: r.id,
        name: r.name,
        created: Boolean(z),
        z2mName: z?.friendly_name ?? null,
        members: (z?.members ?? []).map((m) => ({ ieee: m.ieee_address.toLowerCase(), endpoint: m.endpoint, name: names.get(m.ieee_address.toLowerCase()) })),
        note: r.note,
        plannedMembers: (JSON.parse(r.planned_members) as string[]).map((ieee) => ({ ieee, name: names.get(ieee) })),
        properties: r.z2m_id !== null ? (this.zigbee?.groupProperties(r.z2m_id) ?? []) : [],
      };
    });
  }

  get(id: number): LightGroup | null {
    return this.list().find((g) => g.id === id) ?? null;
  }

  /** A group's stored record, without asking Zigbee2MQTT: for checks and names in other modules. */
  summary(id: number): { id: number; name: string; created: boolean; plannedMembers: string[] } | null {
    const row = this.db.prepare('SELECT id, name, z2m_id, planned_members FROM light_groups WHERE id = ?').get(id) as
      | { id: number; name: string; z2m_id: number | null; planned_members: string }
      | undefined;
    return row ? { id: row.id, name: row.name, created: row.z2m_id !== null, plannedMembers: JSON.parse(row.planned_members) as string[] } : null;
  }

  /**
   * A group known only by name, such as one imported from Tuya, to be created when its bulbs have joined. With
   * `planned`, the note and the devices it will probably have are (re)set.
   */
  plan(name: string, note = '', planned?: string[]): number {
    const clean = cleanName(name);
    const row = this.db.prepare('SELECT id FROM light_groups WHERE name = ?').get(clean) as { id: number } | undefined;
    const id = row ? row.id : Number(this.db.prepare('INSERT INTO light_groups (name, note) VALUES (?, ?)').run(clean, note).lastInsertRowid);
    if (planned) this.db.prepare('UPDATE light_groups SET note = ?, planned_members = ? WHERE id = ?').run(note, JSON.stringify(planned), id);
    return id;
  }

  /** Creates a new group, or creates a planned one in Zigbee2MQTT, with the given members. */
  async create(input: { name?: unknown; members?: unknown; id?: number }): Promise<LightGroup> {
    if (!this.zigbee?.connected()) throw new GroupError('Zigbee2MQTT is not connected', 503);
    const members = cleanMembers(input.members);
    if (members.length === 0) throw new GroupError('Choose at least one device');
    for (const m of members) {
      const row = new Devices(this.db).get(m.ieee);
      if (row?.status !== 'joined') throw new GroupError(`${m.ieee} has not joined yet`, 409);
    }
    let id = input.id;
    let name: string;
    if (id !== undefined) {
      const row = this.db.prepare('SELECT name, z2m_id FROM light_groups WHERE id = ?').get(id) as { name: string; z2m_id: number | null } | undefined;
      if (!row) throw new GroupError('Unknown group', 404);
      if (row.z2m_id !== null && this.zigbee.groups().some((g) => g.id === row.z2m_id)) throw new GroupError('The group already exists', 409);
      name = row.name;
    } else {
      name = cleanName(input.name);
      if (this.db.prepare('SELECT 1 FROM light_groups WHERE name = ?').get(name)) throw new GroupError('A group with this name already exists', 409);
    }
    let z;
    try {
      z = await this.zigbee.createGroup(name, members);
    } catch (err) {
      throw new GroupError((err as Error).message, err instanceof CommandError ? err.status : 502);
    }
    if (id === undefined) id = Number(this.db.prepare('INSERT INTO light_groups (name, z2m_id) VALUES (?, ?)').run(name, z.id).lastInsertRowid);
    else this.db.prepare('UPDATE light_groups SET z2m_id = ? WHERE id = ?').run(z.id, id);
    return { id, name, created: true, z2mName: z.friendly_name, members, note: '', plannedMembers: [], properties: [] };
  }

  async setMembers(id: number, raw: unknown): Promise<void> {
    const row = this.db.prepare('SELECT z2m_id FROM light_groups WHERE id = ?').get(id) as { z2m_id: number | null } | undefined;
    if (!row) throw new GroupError('Unknown group', 404);
    if (row.z2m_id === null || !this.zigbee) throw new GroupError('Create the group first', 409);
    const wanted = cleanMembers(raw);
    const current = this.zigbee.groups().find((g) => g.id === row.z2m_id)?.members ?? [];
    const key = (ieee: string, ep?: number) => `${ieee.toLowerCase()}/${ep ?? 1}`;
    const wantedKeys = new Set(wanted.map((m) => key(m.ieee, m.endpoint)));
    // Each change is a message to the device itself, which stores its groups; one that's off or out of range doesn't
    // answer. The others still change, and the error names the devices that didn't.
    const names = new Devices(this.db).names();
    const failed: string[] = [];
    const attempt = async (ieee: string, change: () => Promise<void>) => {
      try {
        await change();
      } catch (err) {
        failed.push(`${names.get(ieee.toLowerCase()) ?? ieee} (${(err as Error).message})`);
      }
    };
    const zigbee = this.zigbee;
    const groupId = row.z2m_id;
    for (const m of current) {
      if (!wantedKeys.has(key(m.ieee_address, m.endpoint))) await attempt(m.ieee_address, () => zigbee.removeGroupMember(groupId, m.ieee_address, m.endpoint));
    }
    const currentKeys = new Set(current.map((m) => key(m.ieee_address, m.endpoint)));
    for (const m of wanted) if (!currentKeys.has(key(m.ieee, m.endpoint))) await attempt(m.ieee, () => zigbee.addGroupMember(groupId, m.ieee, m.endpoint));
    if (failed.length) {
      throw new GroupError(`Not changed for ${failed.join('; ')}. The device has to be on and in range; try again when it is.`, 502);
    }
  }

  async remove(id: number): Promise<void> {
    const row = this.db.prepare('SELECT z2m_id FROM light_groups WHERE id = ?').get(id) as { z2m_id: number | null } | undefined;
    if (!row) throw new GroupError('Unknown group', 404);
    if (row.z2m_id !== null && this.zigbee?.groups().some((g) => g.id === row.z2m_id)) await this.zigbee.removeGroup(row.z2m_id);
    this.db.prepare('DELETE FROM light_groups WHERE id = ?').run(id);
  }

  async command(id: number, values: Record<string, unknown>): Promise<void> {
    const row = this.db.prepare('SELECT z2m_id FROM light_groups WHERE id = ?').get(id) as { z2m_id: number | null } | undefined;
    if (!row) throw new CommandError('Unknown group', 404);
    if (row.z2m_id === null) throw new CommandError('The group has not been created yet; its devices have not all moved', 409);
    if (!this.zigbee) throw new CommandError('Zigbee2MQTT is not connected', 503);
    await this.zigbee.groupCommand(row.z2m_id, values);
  }
}
