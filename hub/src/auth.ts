import crypto from 'node:crypto';
import { OWNER_USERNAME, type Db } from './db.js';

// Local sign-in for the internal interface: one owner account (MVP), scrypt password hashes, server-side sessions.

export const SESSION_COOKIE = 'hub_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class Auth {
  // Simple per-address throttle for failed sign-ins.
  private failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly db: Db) {}

  setupRequired(): boolean {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE username = ?').get(OWNER_USERNAME) as { password_hash: string | null };
    return !row.password_hash;
  }

  setOwnerPassword(password: string): void {
    if (password.length < MIN_PASSWORD) throw new AuthError(`Use at least ${MIN_PASSWORD} characters`, 400);
    if (!this.setupRequired()) throw new AuthError('The password is already set', 409);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword(password), OWNER_USERNAME);
  }

  /** Clears the owner password and all sessions, so the next visit shows first-run setup again. */
  resetOwnerPassword(): void {
    this.db.prepare('UPDATE users SET password_hash = NULL WHERE username = ?').run(OWNER_USERNAME);
    this.db.prepare('DELETE FROM sessions').run();
    this.failures.clear();
  }

  login(password: string, from: string): string {
    const now = Date.now();
    const row = this.checkPassword(password, from, 401);
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), row.id, now + SESSION_TTL_MS);
    return token;
  }

  /** Asks for the admin password again before a sensitive step, such as downloading the network key. */
  confirmPassword(password: string, from: string): void {
    this.checkPassword(password, from, 403);
  }

  private checkPassword(password: string, from: string, status: number): { id: number } {
    const now = Date.now();
    const f = this.failures.get(from);
    if (f && f.until > now) throw new AuthError('Too many attempts. Try again in a minute.', 429);
    const row = this.db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(OWNER_USERNAME) as { id: number; password_hash: string | null };
    if (!verifyPassword(password, row.password_hash)) {
      const count = (f?.count ?? 0) + 1;
      this.failures.set(from, { count, until: count >= 5 ? now + 60000 : 0 });
      throw new AuthError('Wrong password', status);
    }
    this.failures.delete(from);
    return row;
  }

  userForSession(token: string | undefined): number | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { user_id: number; expires_at: number }
      | undefined;
    return row && row.expires_at > Date.now() ? row.user_id : null;
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
