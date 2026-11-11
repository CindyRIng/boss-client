/**
 * 简单令牌桶/间隔限频（单并发）
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  private nextAt = 0;

  constructor(
    private readonly perMin: number,
    private readonly jitterMs = 0,
  ) {}

  async acquire(): Promise<void> {
    const interval = this.perMin > 0 ? Math.ceil(60_000 / this.perMin) : 0;
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    if (wait > 0) await sleep(wait);
    const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
    if (jitter > 0) await sleep(jitter);
    this.nextAt = Date.now() + interval;
  }

  get intervalMs(): number {
    return this.perMin > 0 ? Math.ceil(60_000 / this.perMin) : 0;
  }
}

export { sleep };
