import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { isLocalAddress } from './network.js';
import type { Notification, NotificationChannel, NotificationLevel } from './notifications.js';

// Alerts out of the hub through Synology Chat (plan: checks and alerts). DSM keeps its own notification system for
// Synology's packages, so SynBee posts to a Chat channel's incoming webhook instead; the Chat app then pushes it to
// the owner's phone. The webhook address holds a token, so it is kept in the private folder (owner-only) and shown
// only without its token.

export interface ChatSettings {
  url: string;
  /** Notifications at this level and above are posted. */
  minLevel: NotificationLevel;
}

export interface ChatView {
  configured: boolean;
  /** The address without its token. */
  address: string | null;
  minLevel: NotificationLevel;
}

export type ChatPost = (url: string, body: string) => Promise<{ status: number; text: string }>;

const RANK: Record<NotificationLevel, number> = { info: 0, warning: 1, alarm: 2 };
const MARK: Record<NotificationLevel, string> = { info: 'ℹ️', warning: '⚠️', alarm: '🚨' };

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Posts form-encoded, as Chat's incoming webhooks expect. The NAS's own self-signed certificate is accepted on home addresses. */
export const defaultPost: ChatPost = (url, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10_000,
        ...(u.protocol === 'https:' ? { rejectUnauthorized: !isLocalAddress(u.hostname) && u.hostname !== 'localhost' } : {}),
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c.slice(0, 2000)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Synology Chat did not answer in time')));
    req.on('error', reject);
    req.end(body);
  });

export function chatText(n: Pick<Notification, 'level' | 'title' | 'body'>): string {
  return `${MARK[n.level]} ${n.title}${n.body ? `\n${n.body}` : ''}`.slice(0, 1500);
}

export class SynologyChat implements NotificationChannel {
  readonly name = 'Synology Chat';

  constructor(
    private readonly secretsDir: string,
    private readonly post: ChatPost = defaultPost,
    /** Who paused alerts, while they are paused (an app user the owner allowed). */
    private readonly paused: () => { by: string } | null = () => null,
  ) {}

  private file(): string {
    return path.join(this.secretsDir, 'synology-chat.json');
  }

  settings(): ChatSettings | null {
    try {
      const v = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as Partial<ChatSettings>;
      return typeof v.url === 'string' && v.minLevel && v.minLevel in RANK ? { url: v.url, minLevel: v.minLevel } : null;
    } catch {
      return null;
    }
  }

  view(): ChatView {
    const s = this.settings();
    if (!s) return { configured: false, address: null, minLevel: 'warning' };
    const u = new URL(s.url);
    return { configured: true, address: `${u.protocol}//${u.host}${u.pathname}`, minLevel: s.minLevel };
  }

  /** Checks and keeps the webhook address. Only Chat's incoming webhook addresses are accepted. */
  save(input: { url?: unknown; minLevel?: unknown }): ChatView {
    const current = this.settings();
    const minLevel = typeof input.minLevel === 'string' && input.minLevel in RANK ? (input.minLevel as NotificationLevel) : (current?.minLevel ?? 'warning');
    let url = current?.url ?? '';
    if (typeof input.url === 'string' && input.url.trim()) {
      let u: URL;
      try {
        u = new URL(input.url.trim());
      } catch {
        throw new ChatError("That isn't a web address");
      }
      if (!/^https?:$/.test(u.protocol) || u.searchParams.get('api') !== 'SYNO.Chat.External' || u.searchParams.get('method') !== 'incoming' || !u.searchParams.get('token')) {
        throw new ChatError("Paste the incoming webhook's address from Synology Chat (Integration → Incoming Webhooks); it contains api=SYNO.Chat.External and a token");
      }
      url = u.toString();
    }
    if (!url) throw new ChatError('Paste the incoming webhook address first');
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file(), JSON.stringify({ url, minLevel }), { mode: 0o600 });
    return this.view();
  }

  clear(): void {
    fs.rmSync(this.file(), { force: true });
  }

  /** Posts a message; throws with Chat's own reason when it refuses. */
  async send(text: string): Promise<void> {
    const s = this.settings();
    if (!s) throw new ChatError('Synology Chat is not set up', 409);
    const res = await this.post(s.url, `payload=${encodeURIComponent(JSON.stringify({ text }))}`);
    let ok = res.status >= 200 && res.status < 300;
    let reason = `answered ${res.status}`;
    try {
      const j = JSON.parse(res.text) as { success?: boolean; error?: { code?: number; errors?: unknown } };
      if (j.success === false) {
        ok = false;
        reason = `refused it (error ${j.error?.code ?? '?'})`;
      }
    } catch {
      // Not JSON: judged by the status alone.
    }
    if (!ok) throw new ChatError(`Synology Chat ${reason}. Check the webhook in Chat (Integration → Incoming Webhooks).`, 502);
  }

  async deliver(n: Notification): Promise<void> {
    const s = this.settings();
    if (!s || RANK[n.level] < RANK[s.minLevel]) return;
    const pause = this.paused();
    if (pause) {
      console.log(`hub: alert not sent to Synology Chat, paused by ${pause.by}: ${n.title}`);
      return;
    }
    await this.send(chatText(n));
  }
}
