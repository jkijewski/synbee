import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { isLocalAddress } from '../src/network.js';
import { buildInternalServer } from '../src/server.js';
import { signIn, TEST_PASSWORD } from './helpers.js';

const fresh = () => buildInternalServer({ db: openDatabase(':memory:'), version: 'test' });

describe('local addresses', () => {
  it('accepts home network addresses only', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.181', '169.254.1.1', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.5']) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1', '::ffff:8.8.8.8', '', undefined]) {
      expect(isLocalAddress(ip), String(ip)).toBe(false);
    }
  });
});

describe('passwords', () => {
  it('hashes with a salt and verifies', () => {
    const a = hashPassword('correct horse battery');
    expect(a).not.toBe(hashPassword('correct horse battery'));
    expect(verifyPassword('correct horse battery', a)).toBe(true);
    expect(verifyPassword('wrong', a)).toBe(false);
    expect(verifyPassword('x', null)).toBe(false);
  });
});

describe('internal listener access', () => {
  it('refuses connections from outside the home network', async () => {
    const app = fresh();
    const res = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('requires sign-in for the API but not for health and auth state', async () => {
    const app = fresh();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/devices' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json()).toEqual({ setupRequired: true, signedIn: false });
    await app.close();
  });

  it('sets the password once, then signs in and out', async () => {
    const app = fresh();
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'short' } })).statusCode).toBe(400);
    const cookie = await signIn(app);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'another-password' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope-nope-nope' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD } });
    expect(login.statusCode).toBe(200);
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
    await app.close();
  });

  it('throttles repeated wrong passwords', async () => {
    const app = fresh();
    await signIn(app);
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong-password' }, remoteAddress: '192.168.1.50' });
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD }, remoteAddress: '192.168.1.50' });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });
});

describe('password reset', () => {
  it('clears the password and sessions so setup is offered again', async () => {
    const db = openDatabase(':memory:');
    const app = buildInternalServer({ db, version: 'test' });
    const cookie = await signIn(app);
    const { Auth } = await import('../src/auth.js');
    new Auth(db).resetOwnerPassword();
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json()).toEqual({ setupRequired: true, signedIn: false });
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'brand-new-password' } })).statusCode).toBe(200);
    await app.close();
  });
});
