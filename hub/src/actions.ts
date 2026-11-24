import { EventEmitter } from 'node:events';
import type { Db } from './db.js';
import { Devices } from './devices.js';
import { CommandError, type DeviceControl } from './ports.js';
import { LightGroups } from './groups.js';

// User-defined actions: ordered steps that switch devices or light groups.

export type Step =
  | { kind: 'device'; device: string; values: Record<string, unknown> }
  | { kind: 'group'; group: number; values: Record<string, unknown> };

export interface Action {
  id: number;
  name: string;
  icon: string;
  description: string;
  order: number;
  /** Imported and not yet checked. */
  draft: boolean;
  /** What an import couldn't translate, for the owner to check. */
  notes: string;
  steps: Step[];
  tile: TileShow;
}

/** What an action's tile shows in the app: worked out from its steps, nothing, or one device's or group's value. */
export type TileShow = { show: 'auto' } | { show: 'none' } | { show: 'device'; device: string; property: string } | { show: 'group'; group: number };

export type ActionInput = Omit<Action, 'id' | 'tile'> & { tile?: TileShow };

/** Whether every device and group an action or rule uses is ready, and if not, what is missing. */
export interface Readiness {
  ready: boolean;
  missing: string[];
}

export interface StepResult {
  step: number;
  ok: boolean;
  error?: string;
}

export interface RunResult {
  ok: boolean;
  failedStep?: number;
  error?: string;
  steps: StepResult[];
}

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const ICON = /^[a-z0-9_]{1,40}$/;

function validate(input: unknown): ActionInput {
  if (!input || typeof input !== 'object') throw new ActionError('Send an action object');
  const a = input as Record<string, unknown>;
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (!name || name.length > 60) throw new ActionError('Name must be 1 to 60 characters');
  const icon = a.icon === undefined ? 'bolt' : a.icon;
  if (typeof icon !== 'string' || !ICON.test(icon)) throw new ActionError('Icon must be a Material Symbols name, such as lightbulb');
  const description = a.description === undefined ? '' : a.description;
  if (typeof description !== 'string' || description.length > 300) throw new ActionError('Description must be at most 300 characters');
  const order = a.order === undefined ? 0 : a.order;
  if (typeof order !== 'number' || !Number.isInteger(order) || Math.abs(order) > 100000) throw new ActionError('Order must be a whole number');
  const draft = a.draft === true;
  const notes = a.notes === undefined ? '' : a.notes;
  if (typeof notes !== 'string' || notes.length > 2000) throw new ActionError('Notes must be at most 2000 characters');
  const tile = validTile(a.tile);
  if (!Array.isArray(a.steps) || a.steps.length === 0 || a.steps.length > 20) throw new ActionError('An action needs 1 to 20 steps');
  const steps: Step[] = a.steps.map((raw, i) => {
    const st = (raw ?? {}) as Record<string, unknown>;
    if (st.kind === 'device') {
      if (typeof st.device !== 'string' || !/^0x[0-9a-f]{16}$/.test(st.device.toLowerCase())) throw new ActionError(`Step ${i + 1}: choose a device`);
      if (!st.values || typeof st.values !== 'object' || Array.isArray(st.values) || Object.keys(st.values).length === 0) {
        throw new ActionError(`Step ${i + 1}: choose what to set`);
      }
      return { kind: 'device', device: st.device.toLowerCase(), values: st.values as Record<string, unknown> };
    }
    if (st.kind === 'group') {
      if (typeof st.group !== 'number' || !Number.isInteger(st.group) || st.group < 1) throw new ActionError(`Step ${i + 1}: choose a light group`);
      if (!st.values || typeof st.values !== 'object' || Array.isArray(st.values) || Object.keys(st.values).length === 0) {
        throw new ActionError(`Step ${i + 1}: choose what to set`);
      }
      return { kind: 'group', group: st.group, values: st.values as Record<string, unknown> };
    }
    throw new ActionError(`Step ${i + 1}: unknown step type`);
  });
  return { name, icon, description, order, draft, notes, steps, tile };
}

const tileJson = (t: TileShow | undefined) => (!t || t.show === 'auto' ? null : JSON.stringify(t));

function validTile(raw: unknown): TileShow {
  if (raw === undefined || raw === null) return { show: 'auto' };
  const t = raw as Record<string, unknown>;
  if (t.show === 'auto' || t.show === 'none') return { show: t.show };
  if (t.show === 'device' && typeof t.device === 'string' && /^0x[0-9a-f]{16}$/.test(t.device.toLowerCase()) && typeof t.property === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(t.property)) {
    return { show: 'device', device: t.device.toLowerCase(), property: t.property };
  }
  if (t.show === 'group' && typeof t.group === 'number' && Number.isInteger(t.group) && t.group > 0) return { show: 'group', group: t.group };
  throw new ActionError('Choose what the tile shows: automatic, nothing, a device value or a light group');
}

export class Actions extends EventEmitter {
  constructor(
    private readonly db: Db,
    private readonly zigbee?: DeviceControl,
    private readonly groups?: LightGroups,
  ) {
    super();
  }

  list(): Action[] {
    const rows = this.db.prepare('SELECT * FROM actions ORDER BY sort_order, name').all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.hydrate(r));
  }

  get(id: number): Action | null {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : null;
  }

  create(input: unknown): Action {
    const a = validate(input);
    return this.tx(() => {
      const id = Number(
        this.db
          .prepare('INSERT INTO actions (name, icon, description, sort_order, draft, notes, tile_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(a.name, a.icon, a.description, a.order, Number(a.draft), a.notes, tileJson(a.tile)).lastInsertRowid,
      );
      this.writeSteps(id, a.steps);
      return this.get(id)!;
    });
  }

  update(id: number, input: unknown): Action {
    if (!this.get(id)) throw new ActionError('Unknown action', 404);
    const a = validate(input);
    return this.tx(() => {
      this.db
        .prepare('UPDATE actions SET name = ?, icon = ?, description = ?, sort_order = ?, draft = ?, notes = ?, tile_json = ? WHERE id = ?')
        .run(a.name, a.icon, a.description, a.order, Number(a.draft), a.notes, tileJson(a.tile), id);
      this.db.prepare('DELETE FROM action_steps WHERE action_id = ?').run(id);
      this.writeSteps(id, a.steps);
      return this.get(id)!;
    });
  }

  remove(id: number): void {
    if (this.db.prepare('DELETE FROM actions WHERE id = ?').run(id).changes === 0) throw new ActionError('Unknown action', 404);
  }

  /** Runs an action. `hops` counts how many rule events led here, so chains through actions also stop at the limit. */
  async run(id: number, context: { hops?: number; source?: string } = {}): Promise<RunResult> {
    const action = this.get(id);
    if (!action) throw new ActionError('Unknown action', 404);
    const results: StepResult[] = [];
    for (const [i, step] of action.steps.entries()) {
      try {
        if (step.kind === 'device') {
          if (!this.zigbee) throw new Error('Zigbee2MQTT is not connected');
          await this.zigbee.command(step.device, step.values);
        } else {
          if (!this.groups) throw new Error('Light groups are not available');
          await this.groups.command(step.group, step.values);
        }
        results.push({ step: i + 1, ok: true });
      } catch (err) {
        const error = err instanceof CommandError || err instanceof Error ? err.message : String(err);
        results.push({ step: i + 1, ok: false, error });
        const result: RunResult = { ok: false, failedStep: i + 1, error: `Step ${i + 1} failed: ${error}`, steps: results };
        this.emit('ran', { action, result, ...context });
        return result;
      }
    }
    const result: RunResult = { ok: true, steps: results };
    this.emit('ran', { action, result, ...context });
    return result;
  }

  /** The "ready to enable" hint: every device has joined and every group exists. */
  readiness(steps: Step[]): Readiness {
    return stepReadiness(this.db, steps);
  }

  private writeSteps(id: number, steps: Step[]): void {
    const insert = this.db.prepare(
      'INSERT INTO action_steps (action_id, position, kind, device_ieee, group_id, values_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    steps.forEach((st, i) => {
      if (st.kind === 'device') insert.run(id, i, 'device', st.device, null, JSON.stringify(st.values));
      else {
        if (!new LightGroups(this.db).summary(st.group)) throw new ActionError(`Step ${i + 1}: unknown light group`);
        insert.run(id, i, 'group', null, st.group, JSON.stringify(st.values));
      }
    });
  }

  private hydrate(r: Record<string, unknown>): Action {
    const steps = (this.db.prepare('SELECT * FROM action_steps WHERE action_id = ? ORDER BY position').all(r.id as number) as Array<Record<string, unknown>>).map(
      (s): Step =>
        s.kind === 'device'
          ? { kind: 'device', device: s.device_ieee as string, values: JSON.parse(s.values_json as string) as Record<string, unknown> }
          : { kind: 'group', group: s.group_id as number, values: JSON.parse(s.values_json as string) as Record<string, unknown> },
    );
    return {
      id: r.id as number,
      name: r.name as string,
      icon: r.icon as string,
      description: r.description as string,
      order: r.sort_order as number,
      draft: r.draft === 1,
      notes: (r.notes as string) ?? '',
      steps,
      tile: r.tile_json ? (JSON.parse(r.tile_json as string) as TileShow) : { show: 'auto' },
    };
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Devices that haven't joined and groups not yet created, named as the owner knows them. */
export function stepReadiness(db: Db, steps: Array<{ kind: string; device?: string; group?: number }>): Readiness {
  const missing = new Set<string>();
  const devices = new Devices(db);
  for (const st of steps) {
    if (st.kind === 'device' && st.device) {
      const row = devices.get(st.device);
      if (!row) missing.add(`unknown device ${st.device}`);
      else if (row.status !== 'joined') missing.add(`${row.name} (not moved yet)`);
    } else if (st.kind === 'group' && st.group !== undefined) {
      const group = new LightGroups(db).summary(st.group);
      if (!group) missing.add(`unknown group ${st.group}`);
      else if (!group.created) missing.add(`light group ${group.name} (not created yet)`);
    }
  }
  return { ready: missing.size === 0, missing: [...missing] };
}
