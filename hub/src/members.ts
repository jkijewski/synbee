import crypto from 'node:crypto';
import { transaction, type Db } from './db.js';

// App members (0020): the people who use the mobile app, what each may use, their paired phones and pairing codes.
// Permissions are stored as revocations, so new actions and rooms are allowed by default. The only writer of the
// members tables.

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_PREFIX = 'sb1_';

export interface Phone {
  id: string;
  name: string;
  pairedAt: string;
  lastUsedAt: string | null;
  /** May use the app away from home (0021); off until the owner allows it. */
  outside: boolean;
}

export interface Member {
  id: number;
  name: string;
  revokedActions: number[];
  revokedRooms: number[];
  /** Whether devices without a main room are visible. */
  devicesWithoutRoom: boolean;
  /** May pause alerts from the app (off until the owner allows it). */
  mayPauseAlerts: boolean;
  phones: Phone[];
  /** When the member's current pairing code expires, if one is waiting. */
  pairingUntil: number | null;
}

export interface PhoneIdentity {
  memberId: number;
  memberName: string;
  phoneId: string;
  phoneName: string;
  outside: boolean;
}

export class MemberError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const normaliseCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

function cleanName(raw: unknown, what: string, max: number): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > max) throw new MemberError(`${what} must be 1 to ${max} characters`);
  return name;
}

function idList(raw: unknown, what: string): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 1000 || !raw.every((x) => Number.isInteger(x) && x > 0)) throw new MemberError(`${what} must be a list of ids`);
  return [...new Set(raw as number[])];
}

export class Members {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Member[] {
    const rows = this.db.prepare('SELECT id FROM members ORDER BY name COLLATE NOCASE').all() as Array<{ id: number }>;
    return rows.map((r) => this.get(r.id)!);
  }

  get(id: number): Member | null {
    const row = this.db.prepare('SELECT id, name, no_room_allowed, may_pause_alerts FROM members WHERE id = ?').get(id) as { id: number; name: string; no_room_allowed: number; may_pause_alerts: number } | undefined;
    if (!row) return null;
    const ids = (sql: string) => (this.db.prepare(sql).all(id) as Array<{ x: number }>).map((r) => r.x);
    const phones = this.db
      .prepare('SELECT id, name, paired_at AS pairedAt, last_used_at AS lastUsedAt, outside FROM member_phones WHERE member_id = ? ORDER BY paired_at')
      .all(id) as unknown as Array<Omit<Phone, 'outside'> & { outside: number }>;
    const code = this.db.prepare('SELECT expires_at FROM member_pairing_codes WHERE member_id = ? AND expires_at >= ?').get(id, this.now()) as { expires_at: number } | undefined;
    return {
      id: row.id,
      name: row.name,
      revokedActions: ids('SELECT action_id AS x FROM member_revoked_actions WHERE member_id = ? ORDER BY action_id'),
      revokedRooms: ids('SELECT room_id AS x FROM member_revoked_rooms WHERE member_id = ? ORDER BY room_id'),
      devicesWithoutRoom: row.no_room_allowed === 1,
      mayPauseAlerts: row.may_pause_alerts === 1,
      phones: phones.map((p) => ({ ...p, outside: p.outside === 1 })),
      pairingUntil: code?.expires_at ?? null,
    };
  }

  create(input: { name?: unknown }): Member {
    const name = cleanName(input.name, 'Name', 40);
    this.checkUnique(name, null);
    const id = Number(this.db.prepare('INSERT INTO members (name) VALUES (?)').run(name).lastInsertRowid);
    return this.get(id)!;
  }

  rename(id: number, input: { name?: unknown }): Member {
    this.require(id);
    const name = cleanName(input.name, 'Name', 40);
    this.checkUnique(name, id);
    this.db.prepare('UPDATE members SET name = ? WHERE id = ?').run(name, id);
    return this.get(id)!;
  }

  /** Removes a member with all their phones and permissions. */
  remove(id: number): void {
    if (this.db.prepare('DELETE FROM members WHERE id = ?').run(id).changes === 0) throw new MemberError('Unknown member', 404);
  }

  setPermissions(id: number, input: { revokedActions?: unknown; revokedRooms?: unknown; devicesWithoutRoom?: unknown }): Member {
    this.require(id);
    const actions = idList(input.revokedActions, 'Revoked actions');
    const rooms = idList(input.revokedRooms, 'Revoked rooms');
    if (input.devicesWithoutRoom !== undefined && typeof input.devicesWithoutRoom !== 'boolean') throw new MemberError('devicesWithoutRoom must be true or false');
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM member_revoked_actions WHERE member_id = ?').run(id);
      this.db.prepare('DELETE FROM member_revoked_rooms WHERE member_id = ?').run(id);
      const addAction = this.db.prepare('INSERT INTO member_revoked_actions (member_id, action_id) SELECT ?, id FROM actions WHERE id = ?');
      const addRoom = this.db.prepare('INSERT INTO member_revoked_rooms (member_id, room_id) SELECT ?, id FROM rooms WHERE id = ?');
      for (const a of actions) if (addAction.run(id, a).changes === 0) throw new MemberError(`Unknown action ${a}`);
      for (const r of rooms) if (addRoom.run(id, r).changes === 0) throw new MemberError(`Unknown room ${r}`);
      if (input.devicesWithoutRoom !== undefined) this.db.prepare('UPDATE members SET no_room_allowed = ? WHERE id = ?').run(Number(input.devicesWithoutRoom), id);
    });
    return this.get(id)!;
  }

  /** Allows or forbids a member to pause alerts from the app. */
  setMayPauseAlerts(id: number, allowed: unknown): Member {
    this.require(id);
    if (typeof allowed !== 'boolean') throw new MemberError('allowed is true or false');
    this.db.prepare('UPDATE members SET may_pause_alerts = ? WHERE id = ?').run(Number(allowed), id);
    return this.get(id)!;
  }

  /** A new one-time pairing code for a member, replacing any earlier one. Shown once, stored only as a hash. */
  createPairingCode(id: number): { code: string; expiresAt: number } {
    this.require(id);
    const raw = Array.from(crypto.randomBytes(10), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.db.prepare('DELETE FROM member_pairing_codes WHERE expires_at < ?').run(this.now());
    this.db
      .prepare('INSERT INTO member_pairing_codes (member_id, code_hash, expires_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at')
      .run(id, sha256(normaliseCode(code)), expiresAt);
    return { code, expiresAt };
  }

  /** Pairs a phone with a pairing code, using the code up. Returns the phone's token, which the hub never sees again. */
  pair(code: unknown, phoneName: unknown, { outside = false }: { outside?: boolean } = {}): { token: string; member: { id: number; name: string }; phone: Phone } {
    if (typeof code !== 'string' || code.length > 40) throw new MemberError('A pairing code is required', 401);
    const name = cleanName(phoneName === undefined ? 'Phone' : phoneName, 'Phone name', 60);
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT member_id FROM member_pairing_codes WHERE code_hash = ? AND expires_at >= ?').get(sha256(normaliseCode(code)), this.now()) as
        | { member_id: number }
        | undefined;
      if (!row) throw new MemberError('The pairing code is wrong, used or expired', 401);
      this.db.prepare('DELETE FROM member_pairing_codes WHERE member_id = ?').run(row.member_id);
      const id = crypto.randomUUID();
      const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
      this.db.prepare('INSERT INTO member_phones (id, member_id, name, token_hash, outside) VALUES (?, ?, ?, ?, ?)').run(id, row.member_id, name, sha256(token), Number(outside));
      const member = this.get(row.member_id)!;
      return { token, member: { id: member.id, name: member.name }, phone: member.phones.find((p) => p.id === id)! };
    });
  }

  /** The phone behind an `Authorization: Bearer …` header, or null. Records when the phone was last used. */
  phoneForToken(header: string | undefined): PhoneIdentity | null {
    const m = /^Bearer (sb1_[A-Za-z0-9_-]{43})$/.exec(header ?? '');
    if (!m) return null;
    const row = this.db
      .prepare('SELECT p.id, p.name, p.member_id, p.outside, m.name AS member_name FROM member_phones p JOIN members m ON m.id = p.member_id WHERE p.token_hash = ?')
      .get(sha256(m[1]!)) as { id: string; name: string; member_id: number; outside: number; member_name: string } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE member_phones SET last_used_at = ? WHERE id = ?').run(new Date(this.now()).toISOString(), row.id);
    return { memberId: row.member_id, memberName: row.member_name, phoneId: row.id, phoneName: row.name, outside: row.outside === 1 };
  }

  /** Allows or stops one phone using the app away from home. */
  setPhoneOutside(memberId: number, phoneId: string, outside: unknown): Phone {
    if (typeof outside !== 'boolean') throw new MemberError('outside is true or false');
    if (this.db.prepare('UPDATE member_phones SET outside = ? WHERE member_id = ? AND id = ?').run(Number(outside), memberId, phoneId).changes === 0) throw new MemberError('Unknown phone', 404);
    return this.get(memberId)!.phones.find((p) => p.id === phoneId)!;
  }

  revokePhone(memberId: number, phoneId: string): void {
    if (this.db.prepare('DELETE FROM member_phones WHERE member_id = ? AND id = ?').run(memberId, phoneId).changes === 0) throw new MemberError('Unknown phone', 404);
  }

  actionAllowed(memberId: number, actionId: number): boolean {
    return !this.db.prepare('SELECT 1 FROM member_revoked_actions WHERE member_id = ? AND action_id = ?').get(memberId, actionId);
  }

  /** Whether a member may see a room; `null` is "no room". */
  roomAllowed(memberId: number, roomId: number | null): boolean {
    if (roomId === null) return (this.db.prepare('SELECT no_room_allowed FROM members WHERE id = ?').get(memberId) as { no_room_allowed: number } | undefined)?.no_room_allowed === 1;
    return !this.db.prepare('SELECT 1 FROM member_revoked_rooms WHERE member_id = ? AND room_id = ?').get(memberId, roomId);
  }

  /** Every member, and whether each may use this action or room (0020): for the action's and the room's own page. */
  access(kind: 'action' | 'room', itemId: number): Array<{ id: number; name: string; allowed: boolean }> {
    return (this.db.prepare('SELECT id, name FROM members ORDER BY name COLLATE NOCASE').all() as Array<{ id: number; name: string }>).map((m) => ({
      ...m,
      allowed: kind === 'action' ? this.actionAllowed(m.id, itemId) : this.roomAllowed(m.id, itemId),
    }));
  }

  /** Sets which members may use an action or a room: those listed may, every other member may not. */
  setAccess(kind: 'action' | 'room', itemId: number, allowed: unknown): Array<{ id: number; name: string; allowed: boolean }> {
    const ids = idList(allowed, 'Allowed members');
    const table = kind === 'action' ? 'member_revoked_actions' : 'member_revoked_rooms';
    const column = kind === 'action' ? 'action_id' : 'room_id';
    const exists = this.db.prepare(kind === 'action' ? 'SELECT 1 FROM actions WHERE id = ?' : 'SELECT 1 FROM rooms WHERE id = ?').get(itemId);
    if (!exists) throw new MemberError(kind === 'action' ? 'Unknown action' : 'Unknown room', 404);
    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(itemId);
      const others = ids.length ? `WHERE id NOT IN (${ids.map(() => '?').join(',')})` : '';
      this.db.prepare(`INSERT INTO ${table} (member_id, ${column}) SELECT id, ? FROM members ${others}`).run(itemId, ...ids);
    });
    return this.access(kind, itemId);
  }

  /** Whether a member sees a status tile ("sensors:3", "check:2", "device:0x…"): yes until the owner hides it. */
  tileAllowed(memberId: number, tile: string): boolean {
    return !this.db.prepare('SELECT 1 FROM member_hidden_tiles WHERE member_id = ? AND tile = ?').get(memberId, tile);
  }

  /** Every member, and whether each sees this status tile. */
  tileAccess(tile: string): Array<{ id: number; name: string; allowed: boolean }> {
    return (this.db.prepare('SELECT id, name FROM members ORDER BY name COLLATE NOCASE').all() as Array<{ id: number; name: string }>).map((m) => ({
      ...m,
      allowed: this.tileAllowed(m.id, tile),
    }));
  }

  /** Sets which members see a status tile: those listed do, every other member doesn't. */
  setTileAccess(tile: string, allowed: unknown): Array<{ id: number; name: string; allowed: boolean }> {
    if (!/^(device:0x[0-9a-f]{16}|sensors:\d{1,9}|check:\d{1,9})$/.test(tile)) throw new MemberError('Unknown tile', 404);
    const ids = idList(allowed, 'Allowed members');
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM member_hidden_tiles WHERE tile = ?').run(tile);
      const others = ids.length ? `WHERE id NOT IN (${ids.map(() => '?').join(',')})` : '';
      this.db.prepare(`INSERT INTO member_hidden_tiles (member_id, tile) SELECT id, ? FROM members ${others}`).run(tile, ...ids);
    });
    return this.tileAccess(tile);
  }

  private require(id: number): void {
    if (!this.db.prepare('SELECT 1 FROM members WHERE id = ?').get(id)) throw new MemberError('Unknown member', 404);
  }

  private checkUnique(name: string, id: number | null): void {
    const other = this.db.prepare('SELECT name FROM members WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, id) as { name: string } | undefined;
    if (other) throw new MemberError(`There is already a member called ${other.name}`, 409);
  }
}
