import { describe, expect, it, vi, afterEach } from 'vitest';
import { attentionList } from '../src/attention.js';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { GATEWAY_GRACE_MS, watchDevices } from '../src/device-watchers.js';
import { Energy } from '../src/energy.js';
import { classifyGatewayWeb, GatewayWebCheck } from '../src/gateway-web.js';
import { History } from '../src/history.js';
import { Notifications } from '../src/notifications.js';
import { FakeDevices } from './fake-devices.js';

// The gateway's own protection (0007): its web page's login, and the alarm when its connection is lost.
afterEach(() => vi.useRealTimers());

describe('gateway web page check', () => {
  it('tells an open page from a protected or switched-off one', () => {
    expect(classifyGatewayWeb(200, '<!DOCTYPE html><div id="smPreloader"></div> Logout')).toBe('open');
    expect(classifyGatewayWeb(401, '')).toBe('protected');
    expect(classifyGatewayWeb(200, '<form><input type="password" name="p"></form>')).toBe('protected');
    expect(classifyGatewayWeb(null, '')).toBe('unreachable');
    expect(classifyGatewayWeb(302, '')).toBe('unknown');
  });

  it('checks the coordinator host on port 80, and fails safe', async () => {
    const seen: string[] = [];
    const check = new GatewayWebCheck(() => '192.168.1.50:6638', async (url) => (seen.push(url), { status: url.includes('api2') ? 404 : 200, body: '<html></html>' }));
    expect((await check.check()).web).toBe('open');
    expect(seen).toEqual(['http://192.168.1.50/', 'http://192.168.1.50/api2?action=0&page=0']);
    // An SLZB with a login set: the HTML shell still opens, its data interface asks for the login.
    const slzb = new GatewayWebCheck(() => '192.168.1.50:6638', async (url) => (url.includes('api2') ? { status: 401, body: '' } : { status: 200, body: '<div id="smPreloader"></div> Logout' }));
    expect((await slzb.check()).web).toBe('protected');
    const down = new GatewayWebCheck(() => '192.168.1.50:6638', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect((await down.check()).web).toBe('unreachable');
    expect((await new GatewayWebCheck(() => '').check()).web).toBe('unknown');
  });

  it('warns in the attention list and once in the inbox while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const notifications = new Notifications(db);
    let answer = { status: 200, body: '<html></html>' };
    const gatewayWeb = new GatewayWebCheck(() => '192.168.1.50:6638', async () => answer);
    const stop = watchDevices(fake, { devices: new Devices(db), history: new History(db), energy: new Energy(db), notifications, gatewayWeb });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(attentionList(new Devices(db), fake, gatewayWeb.status()).map((i) => i.what)).toContain('Its web page has no password: turn on web server authentication there');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(notifications.list().filter((n) => n.title.includes('web page has no password'))).toHaveLength(1);
    answer = { status: 401, body: '' };
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(attentionList(new Devices(db), fake, gatewayWeb.status())).toEqual([]);
    stop();
  });

  it("says, when the gateway is lost, that another device may have taken its connection", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const notifications = new Notifications(db);
    const stop = watchDevices(fake, { devices: new Devices(db), history: new History(db), energy: new Energy(db), notifications });
    fake.emit('gateway', { online: false });
    await vi.advanceTimersByTimeAsync(GATEWAY_GRACE_MS + 10);
    const alarm = notifications.list().find((n) => n.title === 'Zigbee gateway not connected')!;
    expect(alarm.level).toBe('alarm');
    expect(alarm.body).toMatch(/another device on the network may have taken its connection/);
    stop();
  });
});

describe('harden gateway security', () => {
  it("keeps the owner's confirmations per gateway, and forgets them on a new address", async () => {
    const { buildInternalServer } = await import('../src/server.js');
    const { signIn } = await import('./helpers.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { Coordinator } = await import('../src/coordinator.js');
    const db = openDatabase(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-'));
    const coordinator = new Coordinator(dir, '192.168.1.30:6638', () => false);
    const app = buildInternalServer({ db, version: 't', coordinator });
    const cookie = await signIn(app);
    const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
      app.inject({ method, url, payload: payload as object, headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect((await call('GET', '/api/gateway/hardening')).json()).toEqual({});
    const after = (await call('PUT', '/api/gateway/hardening', { step: 'whitelist', done: true })).json();
    expect(after.whitelist).toMatch(/^\d{4}-/);
    expect((await call('PUT', '/api/gateway/hardening', { step: 'nonsense', done: true })).statusCode).toBe(400);
    expect((await call('GET', '/api/gateway/hardening?network=2')).statusCode).toBe(404);
    await call('POST', '/api/coordinator/replace', { address: '192.168.1.141:6638', oldDisconnected: true, sameChipFamily: true });
    expect((await call('GET', '/api/gateway/hardening')).json()).toEqual({});
  });
});
