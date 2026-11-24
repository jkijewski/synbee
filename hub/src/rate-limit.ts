// Fixed-window request limits per key (the client address).
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds to wait if over the limit, otherwise 0. */
  take(key: string, now = Date.now()): number {
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    h.count += 1;
    return h.count > this.limit ? Math.ceil((h.resetAt - now) / 1000) : 0;
  }

  /** Whether the key is over the limit now, without counting this as a hit. */
  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    return Boolean(h && h.resetAt > now && h.count >= this.limit);
  }
}
