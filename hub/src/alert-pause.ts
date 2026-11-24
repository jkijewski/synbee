import type { Db } from './db.js';
import { Settings } from './settings.js';

// Pausing alerts (plan: checks and alerts): an app user the owner allows can pause what leaves the hub (Synology Chat)
// for a while. SynBee's own inbox still records every notification. Kept as a setting: until when, and by whom.

export const ALERT_PAUSE_KEY = 'alert-pause';
/** The longest pause: a day. */
export const MAX_PAUSE_MINUTES = 24 * 60;

export interface AlertPauseState {
  until: number;
  by: string;
}

export class AlertPause {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** The pause in force, or null. */
  current(): AlertPauseState | null {
    const p = new Settings(this.db).get<AlertPauseState | null>(ALERT_PAUSE_KEY, null);
    return p && typeof p.until === 'number' && p.until > this.now() ? p : null;
  }

  active(): boolean {
    return this.current() !== null;
  }

  /** Pauses for `minutes` (1 to a day), or resumes with 0. */
  set(minutes: unknown, by: string): AlertPauseState | null {
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > MAX_PAUSE_MINUTES) throw new Error(`Pause for 0 to ${MAX_PAUSE_MINUTES} minutes`);
    const next = minutes === 0 ? null : { until: this.now() + minutes * 60_000, by: by.slice(0, 80) };
    new Settings(this.db).set(ALERT_PAUSE_KEY, next);
    return next;
  }
}
