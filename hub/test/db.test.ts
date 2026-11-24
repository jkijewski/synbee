import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countUsers, LATEST_SCHEMA, openDatabase, OWNER_USERNAME, schemaVersion } from '../src/db.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-db-')), 'hub.db');

describe('database', () => {
  it('creates the schema and seeds exactly one owner', () => {
    const db = openDatabase(tmp());
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA);
    expect(countUsers(db)).toBe(1);
    const row = db.prepare('SELECT username, password_hash FROM users').get() as { username: string; password_hash: null };
    expect(row).toEqual({ username: OWNER_USERNAME, password_hash: null });
    db.close();
  });

  it('is safe to open repeatedly', () => {
    const file = tmp();
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA);
    expect(countUsers(db)).toBe(1);
    db.close();
  });

  it('removes old Node-RED flow steps when upgrading', () => {
    const file = tmp();
    // The schema before Node-RED was removed (11), with a flow step from a 0.1.0 install.
    const old = openDatabase(file, 11);
    const id = Number(old.prepare("INSERT INTO actions (name) VALUES ('evening')").run().lastInsertRowid);
    old.prepare("INSERT INTO action_steps (action_id, position, kind, flow_id) VALUES (?, 0, 'flow', 'evening-lights')").run(id);
    old.prepare("INSERT INTO action_steps (action_id, position, kind, device_ieee, values_json) VALUES (?, 1, 'device', '0x0000000000000001', '{}')").run(id);
    old.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA);
    expect(db.prepare('SELECT kind FROM action_steps').all()).toEqual([{ kind: 'device' }]);
    expect((db.prepare('PRAGMA table_info(action_steps)').all() as Array<{ name: string }>).map((c) => c.name)).not.toContain('flow_id');
    db.close();
  });

  it('removes the phone access tables when upgrading, keeping actions and their steps', () => {
    const file = tmp();
    const old = openDatabase(file, 14);
    const id = Number(old.prepare("INSERT INTO actions (name, exposed, home_screen) VALUES ('evening', 1, 1)").run().lastInsertRowid);
    old.prepare("INSERT INTO action_steps (action_id, position, kind, device_ieee, values_json) VALUES (?, 0, 'device', '0x0000000000000001', '{}')").run(id);
    old.prepare("INSERT INTO settings (key, value) VALUES ('remote', '{}')").run();
    old.close();
    const db = openDatabase(file);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).not.toContain('app_tokens');
    expect(tables).not.toContain('pairing_codes');
    expect(tables).not.toContain('action_users');
    expect(db.prepare('SELECT COUNT(*) AS n FROM action_steps').get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'remote'").get()).toEqual({ n: 0 });
    db.close();
  });

  it('refuses a database from a newer hub', () => {
    const file = tmp();
    const db = openDatabase(file);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => openDatabase(file)).toThrow(/newer than this hub supports/);
  });
});

describe('safety copies before migrating', () => {
  it('copies the database before an upgrade, logs it, and keeps the last three', async () => {
    const { migrationLog, snapshots, KEEP_SNAPSHOTS } = await import('../src/db.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
    const file = path.join(dir, 'hub.db');
    openDatabase(file, 14).close();
    expect(snapshots(file)).toEqual([]); // a new database has nothing to copy
    const db = openDatabase(file);
    expect(snapshots(file)).toHaveLength(1);
    expect(snapshots(file)[0]).toMatchObject({ fromVersion: 14 });
    expect(migrationLog(db)[0]).toMatchObject({ fromVersion: 14, toVersion: LATEST_SCHEMA, snapshot: snapshots(file)[0]!.name });
    // The copy is a working database at the old version.
    const copy = new (await import('node:sqlite')).DatabaseSync(path.join(dir, snapshots(file)[0]!.name));
    expect((copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(14);
    copy.close();
    db.close();
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `hub.db.before-v1${i}-2026010${i}T000000`), 'x');
    openDatabase(file).close(); // no migration: no new copy, nothing pruned yet
    expect(snapshots(file).length).toBe(6);
    expect(KEEP_SNAPSHOTS).toBe(3);
  });
});
