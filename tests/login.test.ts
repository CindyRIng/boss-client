import { describe, it, expect } from 'vitest';
import { LoginCaptchaRequestSchema, LoginSessionSchema } from '../src/domain/login.js';
import { flattenCities } from '../src/data/cities.js';

describe('login schemas', () => {
  it('accepts click captcha points', () => {
    const parsed = LoginCaptchaRequestSchema.safeParse({ kind: 'click', points: [{ x: 0.1, y: 0.2 }] });
    expect(parsed.success).toBe(true);
  });

  it('accepts slider offset', () => {
    const parsed = LoginCaptchaRequestSchema.safeParse({ kind: 'slider', offsetRatio: 0.63 });
    expect(parsed.success).toBe(true);
  });

  it('rejects out-of-range click points', () => {
    const parsed = LoginCaptchaRequestSchema.safeParse({ kind: 'click', points: [{ x: 2, y: 0.2 }] });
    expect(parsed.success).toBe(false);
  });

  it('validates login session shape', () => {
    const parsed = LoginSessionSchema.safeParse({
      loginId: 'login_abc1234567890',
      mode: 'sms',
      state: 'awaiting_sms_code',
      expiresAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('cities', () => {
  it('flattens nested BOSS city data', () => {
    const cities = flattenCities({
      zpData: {
        cityGroup: [
          { name: '河北', sub: [{ code: 101090100, name: '石家庄' }, { code: 101090200, name: '保定' }] },
          { name: '北京', sub: [{ code: 101010100, name: '北京' }] },
        ],
      },
    });
    expect(cities).toHaveLength(3);
    expect(cities.map((c) => c.cityName)).toContain('石家庄');
  });
});
