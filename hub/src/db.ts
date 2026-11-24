import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Each entry upgrades the schema by one version. Never edit a released entry; add a new one.
const migrations: string[] = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );`,
  `CREATE TABLE rooms (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE
   );
   CREATE TABLE devices (
     ieee TEXT PRIMARY KEY CHECK (ieee GLOB '0x[0-9a-f]*' AND length(ieee) = 18),
     name TEXT NOT NULL,
     room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'joined')),
     source TEXT NOT NULL CHECK (source IN ('tuya-import', 'paired')),
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );`,
  `CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );`,
  `CREATE TABLE actions (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     icon TEXT NOT NULL DEFAULT 'bolt',
     description TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL DEFAULT 0,
     exposed INTEGER NOT NULL DEFAULT 0 CHECK (exposed IN (0, 1)),
     home_screen INTEGER NOT NULL DEFAULT 0 CHECK (home_screen IN (0, 1)),
     CHECK (home_screen = 0 OR exposed = 1)
   );
   CREATE TABLE action_steps (
     id INTEGER PRIMARY KEY,
     action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('device', 'flow')),
     device_ieee TEXT,
     values_json TEXT,
     flow_id TEXT,
     UNIQUE (action_id, position)
   );
   CREATE TABLE action_users (
     action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (action_id, user_id)
   );`,
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE pairing_codes (
     code_hash TEXT PRIMARY KEY,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE app_tokens (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     email TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     last_used_at TEXT,
     revoked_at TEXT
   );`,
  // Channel labels, light groups and draft actions for the Tuya move (docs/import-from-tuya.md).
  `CREATE TABLE channel_labels (
     ieee TEXT NOT NULL REFERENCES devices(ieee) ON DELETE CASCADE,
     endpoint TEXT NOT NULL,
     label TEXT NOT NULL,
     PRIMARY KEY (ieee, endpoint)
   );
   CREATE TABLE light_groups (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     z2m_id INTEGER UNIQUE,
     note TEXT NOT NULL DEFAULT ''
   );
   ALTER TABLE actions ADD COLUMN draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1));
   ALTER TABLE actions ADD COLUMN notes TEXT NOT NULL DEFAULT '';
   CREATE TABLE action_steps_new (
     id INTEGER PRIMARY KEY,
     action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('device', 'group', 'flow')),
     device_ieee TEXT,
     group_id INTEGER REFERENCES light_groups(id) ON DELETE CASCADE,
     values_json TEXT,
     flow_id TEXT,
     UNIQUE (action_id, position)
   );
   INSERT INTO action_steps_new (id, action_id, position, kind, device_ieee, values_json, flow_id)
     SELECT id, action_id, position, kind, device_ieee, values_json, flow_id FROM action_steps;
   DROP TABLE action_steps;
   ALTER TABLE action_steps_new RENAME TO action_steps;`,
  // WHEN / IF / THEN rules and their run history (0010).
  `CREATE TABLE rules (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
     draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
     notes TEXT NOT NULL DEFAULT '',
     definition_json TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     CHECK (draft = 0 OR enabled = 0)
   );
   CREATE TABLE rule_runs (
     id INTEGER PRIMARY KEY,
     rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     trigger_text TEXT NOT NULL,
     test INTEGER NOT NULL DEFAULT 0,
     outcome TEXT NOT NULL CHECK (outcome IN ('running', 'completed', 'skipped', 'failed', 'stopped', 'ignored', 'interrupted')),
     reason TEXT NOT NULL DEFAULT '',
     steps_json TEXT NOT NULL DEFAULT '[]',
     conditions_json TEXT NOT NULL DEFAULT '[]'
   );
   CREATE INDEX rule_runs_by_rule ON rule_runs (rule_id, id);`,
  // Devices an imported group probably holds, offered when it is created.
  `ALTER TABLE light_groups ADD COLUMN planned_members TEXT NOT NULL DEFAULT '[]';`,
  // Device icons: one the owner chose, and one from the Tuya import for devices that haven't joined.
  `ALTER TABLE devices ADD COLUMN icon TEXT;
   ALTER TABLE devices ADD COLUMN import_icon TEXT;`,
  // Rooms (0012): an order and icon per room, and the extra rooms a device is also shown in.
  `ALTER TABLE rooms ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE rooms ADD COLUMN icon TEXT;
   CREATE TABLE device_rooms (
     ieee TEXT NOT NULL REFERENCES devices(ieee) ON DELETE CASCADE,
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     PRIMARY KEY (ieee, room_id)
   );`,
  // Room colours (null = picked automatically) and photos (the version changes with each upload).
  `ALTER TABLE rooms ADD COLUMN color TEXT;
   ALTER TABLE rooms ADD COLUMN photo_version INTEGER;`,
  // Removes the old "flow" action steps, which no longer run.
  `DELETE FROM action_steps WHERE kind = 'flow';
   ALTER TABLE action_steps DROP COLUMN flow_id;`,
  // History, energy and notifications (0014): reading history in three resolutions, when each value began, energy per day, notifications,
  // and armed "for N minutes" rule timers.
  `CREATE TABLE readings_raw (ieee TEXT NOT NULL, property TEXT NOT NULL, at INTEGER NOT NULL, value REAL NOT NULL);
   CREATE INDEX readings_raw_series ON readings_raw (ieee, property, at);
   CREATE TABLE readings_5m (ieee TEXT NOT NULL, property TEXT NOT NULL, bucket INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ieee, property, bucket));
   CREATE TABLE readings_1h (ieee TEXT NOT NULL, property TEXT NOT NULL, bucket INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ieee, property, bucket));
   CREATE TABLE value_since (ieee TEXT NOT NULL, property TEXT NOT NULL, value_json TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (ieee, property));
   CREATE TABLE energy_daily (ieee TEXT NOT NULL, day TEXT NOT NULL, kwh REAL NOT NULL, PRIMARY KEY (ieee, day));
   CREATE TABLE energy_counter (ieee TEXT PRIMARY KEY, value REAL NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL,
     level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'alarm')),
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     ieee TEXT,
     rule_id INTEGER,
     dedupe_key TEXT,
     repeats INTEGER NOT NULL DEFAULT 0,
     read INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX notifications_at ON notifications (at);
   CREATE TABLE duration_timers (rule_id INTEGER NOT NULL, slot TEXT NOT NULL, due_at INTEGER NOT NULL, trigger_text TEXT NOT NULL, PRIMARY KEY (rule_id, slot));`,
  // Timer steps (0010): "after N minutes, set …", stored so they survive a restart.
  `CREATE TABLE later_steps (rule_id INTEGER NOT NULL, step INTEGER NOT NULL, due_at INTEGER NOT NULL, action TEXT NOT NULL, PRIMARY KEY (rule_id, step));`,
  // No phone access in the hub: its pairing codes, tokens, settings and per-user action lists go. The actions table
  // keeps its unused exposed and home_screen columns (always 0), since rebuilding it would cascade to its steps.
  `DROP TABLE action_users;
   DROP TABLE app_tokens;
   DROP TABLE pairing_codes;
   DELETE FROM settings WHERE key = 'remote';
   UPDATE actions SET home_screen = 0, exposed = 0;`,
  // App members, their permissions (stored as revocations), paired phones and pairing codes (0020).
  `CREATE TABLE members (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     no_room_allowed INTEGER NOT NULL DEFAULT 1 CHECK (no_room_allowed IN (0, 1)),
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );
   CREATE UNIQUE INDEX members_name ON members (name COLLATE NOCASE);
   CREATE TABLE member_revoked_actions (
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
     PRIMARY KEY (member_id, action_id)
   );
   CREATE TABLE member_revoked_rooms (
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     PRIMARY KEY (member_id, room_id)
   );
   CREATE TABLE member_phones (
     id TEXT PRIMARY KEY,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     paired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     last_used_at TEXT
   );
   CREATE TABLE member_pairing_codes (
     member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL UNIQUE,
     expires_at INTEGER NOT NULL
   );`,
  // What an action's tile shows in the app (0011): automatic, nothing, or one device's or group's value.
  `ALTER TABLE actions ADD COLUMN tile_json TEXT;`,
  // Away from home per phone (0021): off until the owner allows that phone.
  `ALTER TABLE member_phones ADD COLUMN outside INTEGER NOT NULL DEFAULT 0 CHECK (outside IN (0, 1));`,
  // Which upgrades ran, and the copy taken before each, for the Status page (written by db.ts itself).
  `CREATE TABLE migration_log (at TEXT NOT NULL, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, snapshot TEXT);`,
];

/** Copies of the database taken before migrations, kept next to it: the last few only. */
export const KEEP_SNAPSHOTS = 3;
const SNAPSHOT = /^(.+)\.before-v(\d+)-(\d{8}T\d{6})$/;

/** The database copies next to `file`, newest first. */
export function snapshots(file: string): Array<{ name: string; fromVersion: number; at: string; bytes: number }> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => ({ n, m: SNAPSHOT.exec(n) }))
    .filter((x) => x.m && x.m[1] === base)
    .map(({ n, m }) => {
      const t = m![3]!;
      return { name: n, fromVersion: Number(m![2]), at: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`, bytes: fs.statSync(path.join(dir, n)).size };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Before migrating a database that has data, a consistent copy next to it (VACUUM INTO), so a wrong migration or a
 * downgrade has a way back. The oldest copies beyond KEEP_SNAPSHOTS are removed.
 */
function snapshotBeforeMigrating(db: DatabaseSync, file: string, from: number, now = new Date()): string | null {
  if (file === ':memory:' || from === 0) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const target = `${file}.before-v${from}-${stamp}`;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  for (const old of snapshots(file).slice(KEEP_SNAPSHOTS)) fs.rmSync(path.join(path.dirname(file), old.name), { force: true });
  return path.basename(target);
}

export const OWNER_USERNAME = 'owner';
/** The schema version that created migration_log. */
const LOG_FROM = 19;
export const LATEST_SCHEMA = migrations.length;

export type Db = DatabaseSync;

/** Opens and migrates the database. `upTo` stops at an older schema version, for upgrade tests. */
export function openDatabase(file: string, upTo = migrations.length): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const from = schemaVersion(db);
  const snapshot = from < upTo && from <= migrations.length ? snapshotBeforeMigrating(db, file, from) : null;
  migrate(db, upTo);
  // The log table itself arrives with a migration; older targets (tests) don't have it.
  if (from < upTo && upTo >= LOG_FROM) {
    db.prepare('INSERT INTO migration_log (at, from_version, to_version, snapshot) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), from, upTo, snapshot);
  }
  seedOwner(db);
  return db;
}

/** The upgrades that ran, newest first: when, from which schema version to which, and the copy taken before. */
export function migrationLog(db: Db, limit = 5): Array<{ at: string; fromVersion: number; toVersion: number; snapshot: string | null }> {
  if (schemaVersion(db) < LOG_FROM) return [];
  return db.prepare('SELECT at, from_version AS fromVersion, to_version AS toVersion, snapshot FROM migration_log ORDER BY at DESC LIMIT ?').all(limit) as never;
}

/** Runs `fn` in one transaction: all of its writes, or none. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function migrate(db: Db, upTo: number): void {
  let version = schemaVersion(db);
  if (version > migrations.length) {
    throw new Error(`Database schema ${version} is newer than this hub supports (${migrations.length})`);
  }
  for (; version < upTo; version++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// The MVP has exactly one user; the table allows more later.
function seedOwner(db: Db): void {
  db.prepare('INSERT OR IGNORE INTO users (username) VALUES (?)').run(OWNER_USERNAME);
}

export function countUsers(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n;
}
