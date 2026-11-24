import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { signIn } from './helpers.js';
import { listing } from './fixtures-tuya.js';

describe('device names and rooms', () => {
  it('renames a device and assigns, changes and clears its room', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test' });
    const headers = { cookie: await signIn(app) };
    await app.inject({ method: 'POST', url: '/api/import/tuya', payload: listing, headers });
    const url = '/api/devices/0xa4c1380000000001';
    expect((await app.inject({ method: 'PATCH', url, payload: { name: 'Desk', room: 'Office' }, headers })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({ name: 'Desk', room: 'Office' });
    expect((await app.inject({ method: 'GET', url: '/api/rooms', headers })).json().map((r: { name: string }) => r.name)).toEqual(['Office', 'Salon']);
    await app.inject({ method: 'PATCH', url, payload: { room: null }, headers });
    expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({ room: null });
    expect((await app.inject({ method: 'PATCH', url, payload: { name: '  ' }, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/devices/0x0000000000000000', payload: { name: 'x' }, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url, payload: { name: 'x' } })).statusCode).toBe(401);
    await app.close();
  });
});

describe('web UI serving', () => {
  it('serves files, falls back to index.html and blocks path traversal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-web-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>hub</title>');
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test', webRoot: root });
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.body).toContain('<title>hub</title>');
    expect(index.headers['content-security-policy']).toContain("default-src 'self'");
    expect((await app.inject({ method: 'GET', url: '/assets/app.js' })).headers['content-type']).toContain('javascript');
    expect((await app.inject({ method: 'GET', url: '/devices/whatever' })).body).toContain('<title>hub</title>');
    const traversal = await app.inject({ method: 'GET', url: '/..%2F..%2Fetc%2Fpasswd' });
    expect(traversal.body).not.toContain('root:');
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(401);
    await app.close();
  });
});
