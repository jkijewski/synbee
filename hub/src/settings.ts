import type { Db } from './db.js';

// Small key/value store for hub settings, each stored as JSON.
export class Settings {
  constructor(private readonly db: Db) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
}

/** The home's location, for sunrise and sunset (0010). Approximate is enough; null until set. */
export const LOCATION_KEY = 'location';

/**
 * The app away from home (0021): whether the app listener accepts connections from outside the home network, and the
 * address and port phones use there (a DDNS name or public IP, and the port forwarded on the router). Off until set.
 */
export const APP_ACCESS_KEY = 'app-access';
export interface AppAccess {
  outside: boolean;
  /** Host name or IP, without port; empty when not set. */
  address: string;
  /** The outside port; null means the app port itself. */
  port: number | null;
}
export const defaultAppAccess: AppAccess = { outside: false, address: '', port: null };

const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function validateAppAccess(input: unknown): AppAccess {
  const r = (input ?? {}) as Record<string, unknown>;
  const address = typeof r.address === 'string' ? r.address.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
  if (address && (!HOST.test(address) || address.includes(':'))) throw new Error('Use a host name or IP address, such as home.example.net, without the port');
  const port = r.port === null || r.port === undefined || r.port === '' ? null : Number(r.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('The port is 1 to 65535');
  if (port === 443 || port === 80) throw new Error('Ports 80 and 443 belong to DSM; use another one, such as 8443');
  const outside = r.outside === true;
  if (outside && !address) throw new Error('Enter the address phones use away from home first');
  return { outside, address, port };
}
