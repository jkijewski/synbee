import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { signIn } from './helpers.js';
import { ieeeFromNodeId, importTuyaListing, ImportError, parseListing } from '../src/tuya-import.js';
import { FAKE_KEY, listing } from './fixtures-tuya.js';

describe('Tuya listing import', () => {
  it('derives Zigbee addresses from node IDs', () => {
    expect(ieeeFromNodeId('a4c1380000000001')).toBe('0xa4c1380000000001');
    expect(ieeeFromNodeId('A4C1380000000002')).toBe('0xa4c1380000000002');
    expect(ieeeFromNodeId('0x60a423fffe000002')).toBe('0x60a423fffe000002');
    expect(ieeeFromNodeId('xyz')).toBeNull();
  });

  it('imports pending devices with names and rooms, and reports skipped entries', () => {
    const db = openDatabase(':memory:');
    const r = importTuyaListing(db, listing);
    expect(r.imported.map((d) => d.ieee)).toEqual(['0xa4c1380000000001', '0xa4c1380000000002', '0x60a423fffe000002']);
    expect(r.skipped).toEqual([
      { name: 'Smart Gateway', reason: 'gateway, not a Zigbee device' },
      { name: 'broken', reason: 'node_id is not a 16-digit Zigbee address' },
    ]);
    const rows = db.prepare('SELECT d.name, d.status, r.name AS room FROM devices d LEFT JOIN rooms r ON r.id = d.room_id ORDER BY d.ieee').all();
    expect(rows).toEqual([
      { name: 'salon półka', status: 'pending', room: 'Salon' },
      { name: 'biurko robocze', status: 'pending', room: null },
      { name: 'Wireless Switch', status: 'pending', room: null },
    ]);
  });

  it('never stores local keys', () => {
    const db = openDatabase(':memory:');
    importTuyaListing(db, listing);
    const everything = JSON.stringify(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) =>
        db.prepare(`SELECT * FROM "${(t as { name: string }).name}"`).all(),
      ),
    );
    expect(everything).not.toContain(FAKE_KEY);
  });

  it('updates pending names on re-import but keeps paired devices', () => {
    const db = openDatabase(':memory:');
    importTuyaListing(db, listing);
    db.prepare("UPDATE devices SET status = 'joined' WHERE ieee = '0xa4c1380000000002'").run();
    const again = importTuyaListing(db, [
      { name: 'biurko (nowe)', node_id: 'a4c1380000000001' },
      { name: 'renamed remote', node_id: 'a4c1380000000002' },
    ]);
    expect(again.updated).toEqual([{ ieee: '0xa4c1380000000001', name: 'biurko (nowe)' }]);
    expect(again.skipped).toEqual([{ name: 'renamed remote', reason: 'already paired; its name is kept' }]);
  });

  it('rejects malformed input', () => {
    expect(() => parseListing('not json')).toThrow(ImportError);
    expect(() => parseListing('{"a":1}')).toThrow(/list/);
    expect(() => parseListing(JSON.stringify(new Array(501).fill({})))).toThrow(/Too many/);
  });

  it('imports through the internal API without echoing keys', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test' });
    const headers = { cookie: await signIn(app) };
    const res = await app.inject({ method: 'POST', url: '/api/import/tuya', payload: listing, headers });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(FAKE_KEY);
    expect(res.json().imported).toHaveLength(3);
    const bad = await app.inject({ method: 'POST', url: '/api/import/tuya', payload: { not: 'a list' }, headers });
    expect(bad.statusCode).toBe(400);
    const devices = await app.inject({ method: 'GET', url: '/api/devices', headers });
    expect(devices.json()).toHaveLength(3);
    await app.close();
  });
});
