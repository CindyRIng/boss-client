import { describe, it, expect } from 'vitest';
import { assertBossEnvelope } from '../src/adapters/boss/raw.js';
import { BossError, ERROR_CATALOG } from '../src/errors/catalog.js';

describe('BOSS risk envelopes', () => {
  it('maps code36 to ACCOUNT_RISK instead of generic upstream unavailable', () => {
    expect(() => assertBossEnvelope({ code: 36, message: '您的账户存在异常行为', zpData: {} }, '搜索')).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_RISK' }),
    );
  });

  it('maps code37 to UPSTREAM_BLOCKED', () => {
    expect(() => assertBossEnvelope({ code: 37, message: '环境异常', zpData: {} }, '搜索')).toThrowError(
      expect.objectContaining({ code: 'UPSTREAM_BLOCKED' }),
    );
  });

  it('keeps code36 non-retryable and documented', () => {
    expect(ERROR_CATALOG.ACCOUNT_RISK.retryable).toBe(false);
    expect(new BossError('ACCOUNT_RISK').code).toBe('ACCOUNT_RISK');
  });
});
