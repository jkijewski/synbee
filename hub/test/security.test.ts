import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer, isHomeHost, sameOrigin } from '../src/server.js';
import { signIn } from './helpers.js';

// Findings of the security review of 2026-11-21.
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

describe('security', () => {
  it('asks for sign-in on the home listener for encoded API paths too', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 't' });
    closers.push(() => app.close());
    await signIn(app); // a password exists, but this request has no session
    for (const url of ['/%61pi/devices', '/api/%64evices', '/api/devices']) expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
  });

  it('refuses outside host names (DNS rebinding) and changes from other origins', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 't' });
    closers.push(() => app.close());
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { host: 'evil.example.com' }, payload: { password: 'x'.repeat(12) } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { host: '192.168.1.20:8090', origin: 'http://192.168.1.20:5001' }, payload: { password: 'x'.repeat(12) } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { host: '192.168.1.20:8090', origin: 'http://192.168.1.20:8090' }, payload: { password: 'x'.repeat(12) } })).statusCode).toBe(200);
  });

  it('marks API answers as not to be cached or sniffed', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 't' });
    closers.push(() => app.close());
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('knows home host names', () => {
    for (const h of ['192.168.1.20:8090', 'localhost', '[::1]:8090', 'nas:8090', 'nas.local', 'nas.home.arpa:8090', 'nas.lan']) expect(isHomeHost(h), h).toBe(true);
    for (const h of [undefined, 'evil.example.com', 'nas.synology.me:8090', '192.168.1.20.nip.io']) expect(isHomeHost(h), String(h)).toBe(false);
    expect(isHomeHost('nas.example.com', ['nas.example.com'])).toBe(true);
    expect(sameOrigin(undefined, 'a:1')).toBe(true);
    expect(sameOrigin('http://a:1', 'a:1')).toBe(true);
    expect(sameOrigin('http://a:2', 'a:1')).toBe(false);
    expect(sameOrigin('null', 'a:1')).toBe(false);
  });
});
