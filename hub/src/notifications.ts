import type { Db } from './db.js';
import { Settings } from './settings.js';

// Notifications (0014): kept in the hub's inbox (the bell in the web interface) and handed to any extra channels,
// such as push messages, if added later. Repeats of the same notification within a few minutes are folded into one,
// and a runaway rule can't flood the inbox. The only writer of `notifications`.

export type NotificationLevel = 'info' | 'warning' | 'alarm';

export interface NotificationInput {
  level: NotificationLevel;
  title: string;
  body?: string;
  /** The device it is about, for a link. */
  ieee?: string;
  /** The rule that sent it, for a link. */
  ruleId?: number;
  /** Notifications with the same key within DEDUPE_MS become one, with a repeat count. */
  dedupeKey?: string;
}

export interface Notification {
  id: number;
  at: number;
  level: NotificationLevel;
  title: string;
  body: string;
  ieee: string | null;
  ruleId: number | null;
  repeats: number;
  read: boolean;
}

/** Where notifications go besides the inbox. */
export interface NotificationChannel {
  name: string;
  deliver(n: Notification): Promise<void> | void;
}

export const NOTIFY_KEY = 'notifications';
export interface NotificationSettings {
  /** Notify by itself when a leak, smoke, carbon monoxide or gas alarm starts. */
  autoAlarms: boolean;
}
export const DEFAULT_NOTIFY: NotificationSettings = { autoAlarms: true };

export const DEDUPE_MS = 10 * 60_000;
/** At most this many new notifications an hour; alarms always get through. */
export const MAX_PER_HOUR = 60;
const KEEP = 1000;

export class Notifications {
  private readonly channels: NotificationChannel[] = [];

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  settings(): NotificationSettings {
    return { ...DEFAULT_NOTIFY, ...new Settings(this.db).get<Partial<NotificationSettings>>(NOTIFY_KEY, {}) };
  }

  saveSettings(input: unknown): NotificationSettings {
    const i = (input ?? {}) as Record<string, unknown>;
    const next = { ...this.settings(), ...(typeof i.autoAlarms === 'boolean' ? { autoAlarms: i.autoAlarms } : {}) };
    new Settings(this.db).set(NOTIFY_KEY, next);
    return next;
  }

  /** Adds a notification, or counts a repeat of a recent one. Returns null when the hourly limit dropped it. */
  notify(input: NotificationInput): Notification | null {
    const at = this.now();
    const title = input.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || 'Notification';
    const body = (input.body ?? '').slice(0, 1000);
    if (input.dedupeKey) {
      const recent = this.db
        .prepare('SELECT id FROM notifications WHERE dedupe_key = ? AND at >= ? ORDER BY id DESC LIMIT 1')
        .get(input.dedupeKey, at - DEDUPE_MS) as { id: number } | undefined;
      if (recent) {
        this.db.prepare('UPDATE notifications SET repeats = repeats + 1, at = ?, read = 0 WHERE id = ?').run(at, recent.id);
        return this.get(recent.id);
      }
    }
    if (input.level !== 'alarm') {
      const lastHour = (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE at >= ?').get(at - 3_600_000) as { n: number }).n;
      if (lastHour >= MAX_PER_HOUR) return null;
    }
    const id = Number(
      this.db
        .prepare('INSERT INTO notifications (at, level, title, body, ieee, rule_id, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(at, input.level, title, body, input.ieee ?? null, input.ruleId ?? null, input.dedupeKey ?? null).lastInsertRowid,
    );
    this.db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)').run(KEEP);
    const n = this.get(id)!;
    for (const c of this.channels) {
      void Promise.resolve()
        .then(() => c.deliver(n))
        .catch((err: Error) => console.warn(`hub: notification channel ${c.name} failed: ${err.message}`));
    }
    return n;
  }

  get(id: number): Notification | null {
    const r = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? hydrate(r) : null;
  }

  list(limit = 100): Notification[] {
    return (this.db.prepare('SELECT * FROM notifications ORDER BY at DESC, id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>).map(hydrate);
  }

  unread(): { count: number; alarm: boolean } {
    const r = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(level = 'alarm'), 0) AS alarm FROM notifications WHERE read = 0").get() as { n: number; alarm: number };
    return { count: r.n, alarm: r.alarm === 1 };
  }

  markRead(id: number): boolean {
    return this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id).changes > 0;
  }

  markAllRead(): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  }
}

function hydrate(r: Record<string, unknown>): Notification {
  return {
    id: r.id as number,
    at: r.at as number,
    level: r.level as NotificationLevel,
    title: r.title as string,
    body: r.body as string,
    ieee: (r.ieee as string | null) ?? null,
    ruleId: (r.rule_id as number | null) ?? null,
    repeats: r.repeats as number,
    read: r.read === 1,
  };
}
