import crypto from 'node:crypto';

// The SMLIGHT SLZB-OS web interface (0007, option B of "Harden gateway security"): read and set the gateway's own
// settings with the owner's SLZB login. SMLIGHT doesn't document this interface ("may change without notice"); it is
// what the device's own web page uses: GET /api2?action=0&page=<n> returns a page with its current values in the
// respValuesArr header, and a form posted to /settings/saveParams with pageId=<n> saves it. Logins are HTTP Digest.

export class SlzbError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

/** Parses a WWW-Authenticate: Digest header into its parameters. */
export function parseDigest(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[m[1]!] = m[2] ?? m[3] ?? '';
  return out;
}

/** The Authorization header for one request, as RFC 7616 (MD5, qop=auth). */
export function digestAuthorization(challenge: Record<string, string>, user: string, password: string, method: string, uri: string, cnonce: string, nc = 1): string {
  const ha1 = md5(`${user}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const ncHex = nc.toString(16).padStart(8, '0');
  const qop = challenge.qop ? 'auth' : undefined;
  const response = qop ? md5(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [`username="${user}"`, `realm="${challenge.realm}"`, `nonce="${challenge.nonce}"`, `uri="${uri}"`, `response="${response}"`];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

export class SlzbClient {
  constructor(
    private readonly host: string,
    private readonly login: { user: string; password: string } | null,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) as never,
  ) {}

  private challenge: Record<string, string> | null = null;
  private nc = 0;
  private last = 0;

  /**
   * One request, answering a Digest challenge with the login when there is one, and reusing the challenge for the next
   * requests. Requests are spaced out: SMLIGHT asks for at most one a second, as the gateway serves one at a time.
   */
  private async request(method: string, uri: string, body?: string, headers: Record<string, string> = {}) {
    const url = `http://${this.host}${uri}`;
    const wait = this.last + 400 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const authorised = (challenge: Record<string, string>) => {
      this.nc += 1;
      return { ...headers, Authorization: digestAuthorization(challenge, this.login!.user, this.login!.password, method, uri, crypto.randomBytes(8).toString('hex'), this.nc) };
    };
    let res = await this.fetchFn(url, { method, headers: this.challenge && this.login ? authorised(this.challenge) : headers, body });
    if (res.status === 401) {
      const header = res.headers.get('www-authenticate');
      if (!header || !this.login) throw new SlzbError('The gateway asks for its login; enter it in SynBee first', 401);
      this.challenge = parseDigest(header);
      this.nc = 0;
      await new Promise((r) => setTimeout(r, 200));
      res = await this.fetchFn(url, { method, headers: authorised(this.challenge), body });
      if (res.status === 401) throw new SlzbError("The gateway didn't accept the login: check the user and password on its Security page", 401);
    }
    this.last = Date.now();
    if (res.status >= 400) throw new SlzbError(`The gateway answered ${res.status}`);
    return res;
  }

  /** A settings page's current values (the gateway's own names), and its form fields. */
  async page(num: number): Promise<{ values: Record<string, unknown>; fields: string[] }> {
    const res = await this.request('GET', `/api2?action=0&page=${num}`);
    const html = await res.text();
    let values: Record<string, unknown> = {};
    try {
      values = JSON.parse(res.headers.get('respvaluesarr') ?? '{}') as Record<string, unknown>;
    } catch {
      throw new SlzbError("The gateway's settings could not be read; its firmware may have changed");
    }
    const fields = [...new Set([...html.matchAll(/name=["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1]!))];
    return { values, fields };
  }

  /** Saves fields of one settings page, as its own form does (unticked boxes as "off"). */
  async save(pageId: number, fields: Record<string, string>): Promise<unknown> {
    const boundary = `----synbee${crypto.randomBytes(8).toString('hex')}`;
    const parts = Object.entries({ ...fields, pageId: String(pageId) }).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    const body = `${parts.join('')}--${boundary}--\r\n`;
    const res = await this.request('POST', '/settings/saveParams', body, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

// ---- The gateway's security settings (Security, MQTT and Network pages), read and set as its own forms do. ----

export const SLZB_PAGES = { network: 2, security: 4, zhubMqtt: 17, mqtt: 24 } as const;
/** Firmware builds these requests were checked against; others need the owner's go-ahead. */
export const TESTED_BUILDS = [20260322];

export interface SlzbSecurity {
  device: string;
  build: number | null;
  tested: boolean;
  webLogin: boolean;
  whitelist: { on: boolean; ip: string };
  apPassword: boolean;
  webOffWhileConnected: boolean;
  mqtt: boolean;
  wifiConfigured: boolean;
}

const on = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const box = (v: boolean) => (v ? 'on' : 'off');

/** Reads the gateway's protections from its own settings pages. Refuses a device that doesn't look like an SLZB. */
export async function readSecurity(client: SlzbClient): Promise<SlzbSecurity> {
  const sec = (await client.page(SLZB_PAGES.security)).values;
  // Boxes that are off, and text fields that are empty, may be left out of the values; only the login is always there.
  if (!('login' in sec)) {
    const keys = Object.keys(sec).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)).sort().join(', ');
    throw new SlzbError(`This doesn't look like an SLZB Security page SynBee knows; its firmware may differ (it sent: ${keys || 'nothing'})`, 409);
  }
  const device = String(sec.DEVICE ?? '');
  if (!/^SLZB/i.test(device)) throw new SlzbError('Only SMLIGHT SLZB gateways can be set from SynBee', 409);
  const build = Number(sec.BUILD_DATE) || null;
  const mqtt = (await client.page(SLZB_PAGES.mqtt)).values;
  const zhub = (await client.page(SLZB_PAGES.zhubMqtt)).values;
  const net = (await client.page(SLZB_PAGES.network)).values;
  return {
    device,
    build,
    tested: build !== null && TESTED_BUILDS.includes(build),
    webLogin: on(sec.auth),
    // A box that is off isn't in the values at all; a whitelist IP may be kept while the whitelist is off.
    whitelist: { on: on(sec.fwEnabled), ip: on(sec.fwEnabled) ? String(sec.fwIp ?? '') : '' },
    apPassword: on(sec.apPassEnabled),
    webOffWhileConnected: on(sec.sockWebDsbl),
    mqtt: on(mqtt.mqttEn) || on(zhub.mqttDsEn),
    wifiConfigured: String(net.ssidW ?? '') !== '',
  };
}

export type SecurityChange =
  | { step: 'whitelist'; ip: string | null }
  | { step: 'apPassword'; password: string | null }
  | { step: 'webOffWhileConnected'; on: boolean }
  | { step: 'mqttOff' };

/**
 * Changes one protection. A page saves all its fields at once, so the others are sent back as they are (the web login
 * included, which the gateway returns to a logged-in client). Returns whether the gateway wants a restart.
 */
export async function setSecurity(client: SlzbClient, change: SecurityChange): Promise<{ needReboot: boolean }> {
  const needReboot = (r: unknown) => (r && typeof r === 'object' && typeof (r as { needReboot?: unknown }).needReboot === 'boolean' ? (r as { needReboot: boolean }).needReboot : true);
  if (change.step === 'mqttOff') {
    const mqtt = (await client.page(SLZB_PAGES.mqtt)).values;
    const a = on(mqtt.mqttEn)
      ? await client.save(SLZB_PAGES.mqtt, {
          mqttEn: 'off',
          mqttBroker: String(mqtt.mqttBroker ?? ''),
          mqttPort: String(mqtt.mqttPort ?? 1883),
          mqttUser: String(mqtt.mqttUser ?? ''),
          mqttPass: String(mqtt.mqttPass ?? ''),
          mqttBase: String(mqtt.mqttBase ?? ''),
          mqttQos: String(mqtt.mqttQos ?? 0),
        })
      : { needReboot: false };
    const zhub = (await client.page(SLZB_PAGES.zhubMqtt)).values;
    const b = on(zhub.mqttDsEn) ? await client.save(SLZB_PAGES.zhubMqtt, { mqttDsEn: 'off', mqttDsPrefix: String(zhub.mqttDsPrefix ?? '') }) : { needReboot: false };
    return { needReboot: needReboot(a) || needReboot(b) };
  }
  const sec = (await client.page(SLZB_PAGES.security)).values;
  const fields: Record<string, string> = {
    sockWebDsbl: box(on(sec.sockWebDsbl)),
    auth: box(on(sec.auth)),
    fwEnabled: box(on(sec.fwEnabled)),
    apPassEnabled: box(on(sec.apPassEnabled)),
    login: String(sec.login ?? ''),
    pass: String(sec.pass ?? ''),
    fwIp: String(sec.fwIp ?? ''),
    apPass: String(sec.apPass ?? ''),
  };
  // A page saves all its fields at once: never send back an empty password for a protection that is on.
  if (fields.auth === 'on' && !fields.pass) throw new SlzbError("The gateway didn't return its web login; nothing was changed", 409);
  if (fields.apPassEnabled === 'on' && !fields.apPass && change.step !== 'apPassword') throw new SlzbError("The gateway didn't return its recovery Wi-Fi password; nothing was changed", 409);
  if (fields.fwEnabled === 'on' && !fields.fwIp && change.step !== 'whitelist') throw new SlzbError("The gateway didn't return its allowed address; nothing was changed", 409);
  if (change.step === 'whitelist') {
    fields.fwEnabled = box(change.ip !== null);
    fields.fwIp = change.ip ?? '';
  } else if (change.step === 'apPassword') {
    if (change.password !== null && change.password.length < 8) throw new SlzbError('The recovery Wi-Fi password needs at least 8 characters', 400);
    fields.apPassEnabled = box(change.password !== null);
    fields.apPass = change.password ?? '';
  } else {
    fields.sockWebDsbl = box(change.on);
  }
  return { needReboot: needReboot(await client.save(SLZB_PAGES.security, fields)) };
}
