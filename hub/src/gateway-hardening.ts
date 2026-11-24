import fs from 'node:fs';
import path from 'node:path';
import { networkSuffix } from './networks.js';
import type { Settings } from './settings.js';

// "Harden gateway security" (0007): the gateway's own protections, done by the owner on its Security page and confirmed
// here, one checklist per gateway. SynBee changes nothing on the gateway: the settings interface its web page uses is
// undocumented and may change without notice, and a wrong socket whitelist would cut SynBee off from the radio. The
// web login is checked by SynBee itself (gateway-web.ts); the rest can't be seen from the NAS, so the owner ticks them.
// Confirmations are forgotten when the gateway is replaced or given another address.

export const HARDENING_STEPS = ['whitelist', 'fallbackAp', 'noMqtt', 'wifiOff', 'webOffWhileConnected'] as const;
export type HardeningStep = (typeof HARDENING_STEPS)[number];
/** The steps that matter for every gateway; the others depend on how it's connected and used. */
export const REQUIRED_STEPS: HardeningStep[] = ['whitelist', 'fallbackAp', 'noMqtt'];

export type Hardening = Partial<Record<HardeningStep, string>>; // step → when it was confirmed (ISO)

export class GatewayHardening {
  constructor(
    private readonly settings: Settings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(network: number): string {
    return network === 1 ? 'gateway-hardening' : `gateway-hardening-${network}`;
  }

  get(network: number): Hardening {
    return this.settings.get<Hardening>(this.key(network), {});
  }

  set(network: number, step: unknown, done: unknown): Hardening {
    if (!HARDENING_STEPS.includes(step as HardeningStep)) throw new Error(`Unknown step; use one of ${HARDENING_STEPS.join(', ')}`);
    if (typeof done !== 'boolean') throw new Error('done is true or false');
    const next = { ...this.get(network) };
    if (done) next[step as HardeningStep] = this.now().toISOString();
    else delete next[step as HardeningStep];
    this.settings.set(this.key(network), next);
    return next;
  }

  /** After a replacement or a new address: the new gateway has none of the old one's settings. */
  reset(network: number): void {
    this.settings.set(this.key(network), {});
  }
}

// ---- Option B: SynBee sets the gateway's protections itself, with the owner's gateway login. ----


/** The owner's login to a gateway's own web page, kept like the network key: in the private folder, readable by SynBee only. */
export class GatewayLogins {
  constructor(private readonly secretsDir: string) {}

  private file(network: number): string {
    return path.join(this.secretsDir, `gateway-login${networkSuffix(network)}.json`);
  }

  get(network: number): { user: string; password: string } | null {
    try {
      const v = JSON.parse(fs.readFileSync(this.file(network), 'utf8')) as { user?: unknown; password?: unknown };
      return typeof v.user === 'string' && typeof v.password === 'string' ? { user: v.user, password: v.password } : null;
    } catch {
      return null;
    }
  }

  set(network: number, login: { user: string; password: string }): void {
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file(network), JSON.stringify(login), { mode: 0o600 });
  }

  clear(network: number): void {
    fs.rmSync(this.file(network), { force: true });
  }
}
