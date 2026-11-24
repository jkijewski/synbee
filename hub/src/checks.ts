import type { Condition } from './conditions.js';
import type { Db } from './db.js';
import type { TileLevel } from './sensor-groups.js';

// Checks (plan: checks and alerts): a named statement the owner defines from the same conditions as an automation's
// IF, true or false, with the owner's words and level for each side ("Windows closed": "All windows closed" / "A
// window is open"). The rule engine evaluates them; status tiles, automations (WHEN and IF), actions' IF and
// notification texts read them. A check can't contain another check. The only writer of `checks`.

export interface CheckSide {
  text: string;
  level: TileLevel;
}

export interface Check {
  id: number;
  name: string;
  if: { mode: 'all' | 'any'; conditions: Condition[] };
  whenTrue: CheckSide;
  whenFalse: CheckSide;
  roomId: number | null;
  tile: boolean;
}

export class CheckError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const LEVELS: TileLevel[] = ['fine', 'info', 'warning', 'alarm'];

function side(raw: unknown, what: string, fallback: string): CheckSide {
  const s = (raw ?? {}) as Record<string, unknown>;
  const text = typeof s.text === 'string' && s.text.trim() ? s.text.replace(/[\u0000-\u001f\u007f]/g, '').trim() : fallback;
  if (text.length > 80) throw new CheckError(`${what}: at most 80 characters`);
  const level = (typeof s.level === 'string' && LEVELS.includes(s.level as TileLevel) ? s.level : 'fine') as TileLevel;
  return { text, level };
}

export class Checks {
  constructor(private readonly db: Db) {}

  list(): Check[] {
    return (this.db.prepare('SELECT * FROM checks ORDER BY name').all() as Array<Record<string, unknown>>).map(hydrate);
  }

  get(id: number): Check | null {
    const r = this.db.prepare('SELECT * FROM checks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? hydrate(r) : null;
  }

  /** `input.if` arrives parsed by the rules' own parser (routes/checks.ts); here the rest is checked. */
  create(input: unknown): Check {
    const c = this.validate(input);
    try {
      const id = Number(
        this.db
          .prepare('INSERT INTO checks (name, if_json, true_text, true_level, false_text, false_level, room_id, tile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(c.name, JSON.stringify(c.if), c.whenTrue.text, c.whenTrue.level, c.whenFalse.text, c.whenFalse.level, c.roomId, Number(c.tile)).lastInsertRowid,
      );
      return this.get(id)!;
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new CheckError(`A check named "${c.name}" already exists`, 409);
      throw err;
    }
  }

  update(id: number, input: unknown): Check {
    if (!this.get(id)) throw new CheckError('Unknown check', 404);
    const c = this.validate(input);
    try {
      this.db
        .prepare('UPDATE checks SET name = ?, if_json = ?, true_text = ?, true_level = ?, false_text = ?, false_level = ?, room_id = ?, tile = ? WHERE id = ?')
        .run(c.name, JSON.stringify(c.if), c.whenTrue.text, c.whenTrue.level, c.whenFalse.text, c.whenFalse.level, c.roomId, Number(c.tile), id);
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new CheckError(`A check named "${c.name}" already exists`, 409);
      throw err;
    }
    return this.get(id)!;
  }

  remove(id: number): void {
    if (this.db.prepare('DELETE FROM checks WHERE id = ?').run(id).changes === 0) throw new CheckError('Unknown check', 404);
  }

  private validate(input: unknown): Omit<Check, 'id'> {
    if (!input || typeof input !== 'object') throw new CheckError('Send a check');
    const i = input as Record<string, unknown>;
    const name = typeof i.name === 'string' ? i.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    if (!name || name.length > 60) throw new CheckError('Name must be 1 to 60 characters');
    const cond = i.if as Check['if'] | undefined;
    if (!cond || (cond.mode !== 'all' && cond.mode !== 'any') || !Array.isArray(cond.conditions) || cond.conditions.length === 0) {
      throw new CheckError('A check needs at least one condition');
    }
    if (cond.conditions.some((c) => c.type === 'check')) throw new CheckError("A check can't contain another check; use its conditions instead");
    const roomId = i.roomId === null || i.roomId === undefined ? null : Number(i.roomId);
    if (roomId !== null && (!Number.isInteger(roomId) || !this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId))) throw new CheckError('Unknown room');
    return {
      name,
      if: cond,
      whenTrue: side(i.whenTrue, 'When true', 'Yes'),
      whenFalse: side(i.whenFalse, 'When false', 'No'),
      roomId,
      tile: i.tile !== false,
    };
  }
}

function hydrate(r: Record<string, unknown>): Check {
  return {
    id: r.id as number,
    name: r.name as string,
    if: JSON.parse(r.if_json as string) as Check['if'],
    whenTrue: { text: r.true_text as string, level: r.true_level as TileLevel },
    whenFalse: { text: r.false_text as string, level: r.false_level as TileLevel },
    roomId: (r.room_id as number | null) ?? null,
    tile: r.tile === 1,
  };
}
