import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { CoordinatorBackup, decryptArchive, encryptArchive, sameIeee, STALE_AFTER_DAYS } from '../src/backup.js';
import { Coordinator } from '../src/coordinator.js';
import { buildInternalServer } from '../src/server.js';
import { Settings } from '../src/settings.js';
import { signIn, TEST_PASSWORD } from './helpers.js';
// @ts-expect-error plain JavaScript module of the supervisor
import { applyPendingRestore, coordinatorAddress } from '../supervisor/z2m.mjs';

const KEY_MARKER = 'network_key_1a2b3c4d5e6f';
const PASSPHRASE = 'correct horse battery';
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-backup-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function z2mData(withBackup = true) {
  const root = tmp();
  const data = path.join(root, 'zigbee2mqtt');
  fs.mkdirSync(data);
  if (withBackup) {
    fs.writeFileSync(path.join(data, 'coordinator_backup.json'), JSON.stringify({ coordinator_ieee: '00124b0000000001', network_key: { key: KEY_MARKER } }));
    fs.writeFileSync(path.join(data, 'database.db'), '{"id":1,"type":"Coordinator"}\n');
    fs.writeFileSync(path.join(data, 'configuration.yaml'), `advanced:\n  network_key: ${KEY_MARKER}\n`);
  }
  return { root, data };
}

function setup(withBackup = true, now = () => new Date()) {
  const { root, data } = z2mData(withBackup);
  const db = openDatabase(':memory:');
  const backup = new CoordinatorBackup(data, new Settings(db), now);
  const restarts: string[] = [];
  const secrets = path.join(root, 'secrets');
  const coordinator = new Coordinator(secrets, '192.168.1.50:6638', () => (restarts.push('restart'), true));
  const app = buildInternalServer({ db, version: 'test', backup, coordinator });
  return { root, data, db, backup, coordinator, restarts, secrets, app };
}

describe('backup encryption', () => {
  it('needs the passphrase and detects damage', () => {
    const archive = encryptArchive(Buffer.from('secret stuff'), PASSPHRASE);
    expect(archive.toString('latin1')).not.toContain('secret stuff');
    expect(decryptArchive(archive, PASSPHRASE).toString()).toBe('secret stuff');
    expect(() => decryptArchive(archive, 'wrong passphrase!')).toThrow(/Wrong passphrase/);
    const damaged = Buffer.from(archive);
    damaged[damaged.length - 1]! ^= 1;
    expect(() => decryptArchive(damaged, PASSPHRASE)).toThrow(/Wrong passphrase, or the file is damaged/);
    expect(() => decryptArchive(Buffer.from('hello'), PASSPHRASE)).toThrow(/not a SynBee backup/);
  });
});

describe('coordinator backup status', () => {
  it('warns when the backup is missing, stale or never downloaded, and never shows its contents', async () => {
    expect(setup(false).backup.status()).toMatchObject({ present: false, stale: true, warnings: [expect.stringMatching(/no coordinator backup yet/)] });
    const fresh = setup();
    expect(fresh.backup.status()).toMatchObject({ present: true, stale: false, coordinatorIeee: '0x00124b0000000001', lastDownloadAt: null });
    expect(fresh.backup.status().warnings).toEqual([expect.stringMatching(/Keep a copy off the NAS/)]);
    const old = new Date(Date.now() - (STALE_AFTER_DAYS + 1) * 86_400_000);
    fs.utimesSync(path.join(fresh.data, 'coordinator_backup.json'), old, old);
    expect(fresh.backup.status()).toMatchObject({ stale: true, warnings: expect.arrayContaining([expect.stringMatching(/days old/)]) });
    const headers = { cookie: await signIn(fresh.app) };
    const res = await fresh.app.inject({ method: 'GET', url: '/api/backup', headers });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY_MARKER);
  });
});

describe('protected backup download', () => {
  it('needs a session, the admin password, the warning and a passphrase', async () => {
    const { app } = setup();
    const url = '/api/backup/download';
    const good = { password: TEST_PASSWORD, passphrase: PASSPHRASE, understood: true };
    expect((await app.inject({ method: 'POST', url, payload: good })).statusCode).toBe(401);
    const headers = { cookie: await signIn(app) };
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, password: 'wrong' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, understood: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, passphrase: 'short' } })).statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url, headers, payload: good });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="synbee-coordinator-backup-\d{12}\.synbee-backup"/);
    expect(res.rawPayload.toString('latin1')).not.toContain(KEY_MARKER);
    const content = JSON.parse(decryptArchive(res.rawPayload, PASSPHRASE).toString());
    expect(Object.keys(content.files).sort()).toEqual(['configuration.yaml', 'coordinator_backup.json', 'database.db']);
    expect((await app.inject({ method: 'GET', url: '/api/backup', headers })).json().lastDownloadAt).not.toBeNull();
  });

  it('refuses when there is no backup yet', async () => {
    const { app } = setup(false);
    const headers = { cookie: await signIn(app) };
    const res = await app.inject({ method: 'POST', url: '/api/backup/download', headers, payload: { password: TEST_PASSWORD, passphrase: PASSPHRASE, understood: true } });
    expect(res.statusCode).toBe(409);
  });
});

describe('restoring a downloaded backup', () => {
  it('stages it with the right passphrase and restarts Zigbee2MQTT; the supervisor puts it in place', async () => {
    const source = setup();
    const archive = source.backup.download(PASSPHRASE).data;
    const target = setup(false);
    const headers = { cookie: await signIn(target.app) };
    const url = '/api/backup/restore';
    const payload = { archive: archive.toString('base64'), passphrase: PASSPHRASE, password: TEST_PASSWORD };
    expect((await target.app.inject({ method: 'POST', url, headers, payload: { ...payload, passphrase: 'not the passphrase' } })).statusCode).toBe(400);
    expect((await target.app.inject({ method: 'POST', url, headers, payload: { ...payload, password: 'wrong' } })).statusCode).toBe(403);
    expect(target.restarts).toEqual([]);
    const res = await target.app.inject({ method: 'POST', url, headers, payload });
    expect(res.json()).toMatchObject({ ok: true, coordinatorIeee: '0x00124b0000000001', restarting: true });
    expect(target.restarts).toEqual(['restart']);
    const staged = `${target.data}.restore`;
    expect(fs.statSync(staged).mode & 0o777).toBe(0o700);
    // What the supervisor does before starting Zigbee2MQTT again.
    expect(applyPendingRestore(target.data, new Date('2026-11-20T10:00:00Z'))).toMatch(/previous data is in .*before-restore-2026-11-20T10-00-00-000Z/);
    expect(fs.readFileSync(path.join(target.data, 'configuration.yaml'), 'utf8')).toContain(KEY_MARKER);
    expect(fs.existsSync(staged)).toBe(false);
    expect(applyPendingRestore(target.data)).toBe('');
  });
});

describe('replacing the coordinator', () => {
  it('needs both confirmations and a host:port, then saves the address for the supervisor and restarts Zigbee2MQTT', async () => {
    const { app, restarts, secrets } = setup();
    const headers = { cookie: await signIn(app) };
    const url = '/api/coordinator/replace';
    const good = { address: '192.168.1.141:6638', oldDisconnected: true, sameChipFamily: true };
    expect((await app.inject({ method: 'POST', url, payload: good })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, oldDisconnected: false } })).json().error).toMatch(/disconnected/);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, sameChipFamily: false } })).json().error).toMatch(/EmberZNet/);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...good, address: 'nope' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/coordinator', headers })).json()).toMatchObject({ address: '192.168.1.50:6638', backupIeee: '0x00124b0000000001' });
    expect((await app.inject({ method: 'POST', url, headers, payload: good })).json()).toEqual({ address: '192.168.1.141:6638', restarted: true });
    expect(restarts).toEqual(['restart']);
    expect((await app.inject({ method: 'GET', url: '/api/coordinator', headers })).json().address).toBe('192.168.1.141:6638');
    expect(coordinatorAddress(secrets, '192.168.1.50:6638')).toBe('192.168.1.141:6638');
  });
});

describe('coordinator address in the backup', () => {
  it('matches the coordinator in either byte order (Ember stores it reversed)', () => {
    // Seen on the real SLZB-06MU: backup 0x1122334455667788, coordinator 0x8877665544332211.
    expect(sameIeee('0x1122334455667788', '0x8877665544332211')).toBe(true);
    expect(sameIeee('0x8877665544332211', '0x8877665544332211')).toBe(true);
    expect(sameIeee('0x1122334455667788', '0x00124b0000000001')).toBe(false);
  });
});
