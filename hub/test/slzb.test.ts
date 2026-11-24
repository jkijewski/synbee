import { describe, expect, it } from 'vitest';
import { digestAuthorization, parseDigest, readSecurity, setSecurity, SlzbClient, type Fetch } from '../src/slzb.js';

// Option B of "Harden gateway security" (0007): SynBee reads and sets an SLZB's protections with the owner's login.

/** A stand-in SLZB-06MU (build 20260322): Digest login, settings pages with respValuesArr, multipart saves. */
function fakeSlzb(login = { user: 'admin', password: 'secret-123' }) {
  const state: Record<string, unknown> = { auth: 'true', login: login.user, pass: login.password, fwIp: '', apPassEnabled: '', apPass: '' };
  const mqtt: Record<string, unknown> = { mqttEn: false, mqttBroker: '', mqttPort: 1883, mqttUser: '', mqttPass: '', mqttBase: 'zhub', mqttQos: 0 };
  const zhub: Record<string, unknown> = { mqttDsEn: false, mqttDsPrefix: 'homeassistant' };
  const saves: Array<Record<string, string>> = [];
  const head = { DEVICE: 'SLZB-06MU', BUILD_DATE: 20260322 };
  const authorised = (h?: Record<string, string>) => {
    const a = h?.Authorization ?? '';
    return a.startsWith('Digest ') && a.includes(`username="${login.user}"`) && a.includes('response="');
  };
  const reply = (status: number, body = '', headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
  });
  const fetchFn: Fetch = async (url, init) => {
    if (!authorised(init?.headers)) return reply(401, '401', { 'www-authenticate': 'Digest realm="slzb", qop="auth", nonce="abc", opaque="xyz"' });
    const u = new URL(url);
    if (u.pathname === '/api2') {
      const page = Number(u.searchParams.get('page'));
      const values = page === 4 ? { ...head, ...state } : page === 24 ? { ...head, ...mqtt } : page === 17 ? { ...head, ...zhub } : { ...head, ssidW: '' };
      return reply(200, '<form class="saveParams"></form>', { respvaluesarr: JSON.stringify(values) });
    }
    if (u.pathname === '/settings/saveParams' && init?.method === 'POST') {
      const fields = Object.fromEntries([...String(init.body).matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map((m) => [m[1]!, m[2]!]));
      saves.push(fields);
      const target = fields.pageId === '4' ? state : fields.pageId === '24' ? mqtt : zhub;
      for (const [k, v] of Object.entries(fields)) if (k !== 'pageId') target[k] = v === 'on' ? 'true' : v === 'off' ? '' : v;
      return reply(200, JSON.stringify({ needReboot: fields.pageId === '4' }));
    }
    return reply(404);
  };
  return { fetchFn, state, mqtt, saves };
}

describe('SLZB settings', () => {
  it('answers a Digest challenge as RFC 2617 does', () => {
    const c = parseDigest('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    const header = digestAuthorization(c, 'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', '0a4f113b');
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
  });

  it('reads the protections, and refuses without a login', async () => {
    const slzb = fakeSlzb();
    const sec = await readSecurity(new SlzbClient('gw', { user: 'admin', password: 'secret-123' }, slzb.fetchFn));
    expect(sec).toMatchObject({ device: 'SLZB-06MU', tested: true, webLogin: true, whitelist: { on: false }, apPassword: false, mqtt: false, wifiConfigured: false });
    await expect(readSecurity(new SlzbClient('gw', null, slzb.fetchFn))).rejects.toThrow(/asks for its login/);
  });

  it('sets one protection and sends the others back unchanged, the web login included', async () => {
    const slzb = fakeSlzb();
    const client = new SlzbClient('gw', { user: 'admin', password: 'secret-123' }, slzb.fetchFn);
    expect(await setSecurity(client, { step: 'whitelist', ip: '192.168.1.20' })).toEqual({ needReboot: true });
    expect(slzb.saves[0]).toMatchObject({ pageId: '4', fwEnabled: 'on', fwIp: '192.168.1.20', auth: 'on', login: 'admin', pass: 'secret-123', apPassEnabled: 'off' });
    await setSecurity(client, { step: 'apPassword', password: 'recovery-pw' });
    const sec = await readSecurity(client);
    expect(sec).toMatchObject({ whitelist: { on: true, ip: '192.168.1.20' }, apPassword: true, webLogin: true });
    await expect(setSecurity(client, { step: 'apPassword', password: 'short' })).rejects.toThrow(/8 characters/);
  });

  it('reads a Security page that leaves out empty fields, and names what it got when the login is missing', async () => {
    const slzb = fakeSlzb();
    for (const k of ['fwIp', 'apPass', 'apPassEnabled']) delete slzb.state[k];
    const client = new SlzbClient('gw', { user: 'admin', password: 'secret-123' }, slzb.fetchFn);
    expect(await readSecurity(client)).toMatchObject({ webLogin: true, whitelist: { on: false, ip: '' }, apPassword: false });
    delete slzb.state.login;
    await expect(readSecurity(client)).rejects.toThrow(/it sent: .*BUILD_DATE.*pass/);
  });

  it('switches its own MQTT off only when on', async () => {
    const slzb = fakeSlzb();
    const client = new SlzbClient('gw', { user: 'admin', password: 'secret-123' }, slzb.fetchFn);
    expect(await setSecurity(client, { step: 'mqttOff' })).toEqual({ needReboot: false });
    expect(slzb.saves).toEqual([]);
    slzb.mqtt.mqttEn = true;
    await setSecurity(client, { step: 'mqttOff' });
    expect(slzb.saves[0]).toMatchObject({ pageId: '24', mqttEn: 'off', mqttBase: 'zhub' });
  });
});
