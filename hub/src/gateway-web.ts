// Whether the coordinator's own web page asks for a login (0007). A network coordinator such as the SLZB-06M has a
// configuration page on port 80 that, out of the box, anyone on the home network can open: change its settings, flash
// its firmware, or switch off its socket protection. The hub only reads, anonymously; it never logs in and never
// changes anything. SMLIGHT's page serves its HTML shell to anyone even with a login set; the login guards the data
// interface behind it (/api2), so that is what decides for an SLZB.

export type GatewayWeb = 'protected' | 'open' | 'unreachable' | 'unknown';

export interface GatewayWebStatus {
  web: GatewayWeb;
  /** The page the owner should open to fix it. */
  url: string | null;
  checkedAt: string | null;
}

/** The SLZB-OS data request its page makes first (read only): 401 with a login set, 200 without. */
export const SLZB_DATA_PATH = '/api2?action=0&page=0';

/** Decides from the answer to an anonymous GET of the page's root (for pages other than SMLIGHT's). */
export function classifyGatewayWeb(status: number | null, body: string): GatewayWeb {
  if (status === null) return 'unreachable'; // switched off (e.g. "web server off while the socket is connected"), or no web page
  if (status === 401 || status === 403) return 'protected';
  if (status >= 300 && status < 400) return 'unknown';
  if (status === 200) return /type\s*=\s*["']?password/i.test(body) ? 'protected' : 'open';
  return 'unknown';
}

export class GatewayWebCheck {
  private last: GatewayWebStatus = { web: 'unknown', url: null, checkedAt: null };

  constructor(
    private readonly address: () => string,
    private readonly get: (url: string) => Promise<{ status: number; body: string }> = defaultGet,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(): GatewayWebStatus {
    return this.last;
  }

  async check(): Promise<GatewayWebStatus> {
    const host = this.address().replace(/^tcp:\/\//, '').split(':')[0];
    if (!host) return (this.last = { web: 'unknown', url: null, checkedAt: this.now().toISOString() });
    const url = `http://${host}/`;
    let status: number | null = null;
    let body = '';
    try {
      ({ status, body } = await this.get(url));
    } catch {
      status = null;
    }
    let web = classifyGatewayWeb(status, body);
    if (status === 200) {
      // An SLZB: its data interface tells, whatever the HTML shell says.
      try {
        const data = await this.get(`http://${host}${SLZB_DATA_PATH}`);
        if (data.status === 401 || data.status === 403) web = 'protected';
        else if (data.status === 200) web = 'open';
      } catch {
        // No data interface: keep the front page's answer.
      }
    }
    this.last = { web, url, checkedAt: this.now().toISOString() };
    return this.last;
  }
}

async function defaultGet(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const body = (await res.text()).slice(0, 200_000);
  return { status: res.status, body };
}
