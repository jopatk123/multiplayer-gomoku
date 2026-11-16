export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  try(key: string): boolean {
    if (this.limit <= 0) return true;
    const t = this.now();
    const cutoff = t - this.windowMs;
    const next = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (next.length >= this.limit) {
      this.hits.set(key, next);
      return false;
    }
    next.push(t);
    this.hits.set(key, next);
    return true;
  }

  prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, times] of this.hits) {
      const next = times.filter((at) => at > cutoff);
      if (next.length === 0) this.hits.delete(key);
      else this.hits.set(key, next);
    }
  }
}
