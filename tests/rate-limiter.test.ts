import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/adapters/boss/rate-limiter.js';

describe('rate limiter', () => {
  it('spaces requests by interval', async () => {
    const limiter = new RateLimiter(6000); // 10ms interval
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(8);
  });

  it('no limit when perMin is 0', async () => {
    const limiter = new RateLimiter(0);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
