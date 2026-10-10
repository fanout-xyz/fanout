/**
 * Best-effort, per-instance sliding-window limits (like the relay routes): they reset on a restart and
 * each server instance keeps its own, which bounds cost without needing a store.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Counts this attempt; true when the key is over the limit. */
  limited(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return recent.length > this.max;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }

  /** Tests only. */
  reset() {
    this.hits.clear();
  }
}
