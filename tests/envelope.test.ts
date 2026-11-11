import { describe, it, expect } from 'vitest';
import { failureEnvelope, successEnvelope, SCHEMA_VERSION } from '../src/schemas/envelope.js';

describe('envelope', () => {
  it('wraps success data with meta', () => {
    const env = successEnvelope({ hello: 'world' }, { requestId: 'req_12345678', tookMs: 12, cached: true });
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ hello: 'world' });
    expect(env.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.meta.cached).toBe(true);
    expect(env.error).toBeNull();
  });

  it('wraps errors with retryable flag', () => {
    const env = failureEnvelope({ code: 'RATE_LIMITED', message: 'slow down', retryable: true }, { requestId: 'req_12345678', tookMs: 3 });
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.error.code).toBe('RATE_LIMITED');
    expect(env.error.retryable).toBe(true);
  });

  it('keeps pagination meta', () => {
    const env = successEnvelope([], {
      requestId: 'req_12345678',
      tookMs: 1,
      pagination: { page: 1, pageSize: 15, total: 450, hasMore: true, pagesFetched: 1, pagesAvailable: 30 },
    });
    expect(env.meta.pagination?.pagesAvailable).toBe(30);
  });
});
