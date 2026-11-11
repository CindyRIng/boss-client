import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/schema.js';

describe('config', () => {
  it('loads defaults', () => {
    const cfg = loadConfig({ env: {} });
    expect(cfg.baseUrl).toBe('https://www.zhipin.com');
    expect(cfg.port).toBe(8788);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.headless).toBe(false);
    expect(cfg.session.maxPages).toBe(5);
    expect(cfg.cities[0]).toBe('101090100');
  });

  it('overrides from env', () => {
    const cfg = loadConfig({
      env: {
        BOSS_PORT: '9000',
        BOSS_HEADLESS: 'true',
        BOSS_CITIES: '101010100,101020100',
        BOSS_CACHE_DB: '/tmp/x.db',
      },
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.headless).toBe(true);
    expect(cfg.cities).toEqual(['101010100', '101020100']);
    expect(cfg.cache.dbPath).toBe('/tmp/x.db');
  });

  it('rejects non-local host', () => {
    expect(() => loadConfig({ env: { BOSS_HOST: '0.0.0.0' } })).toThrow(/127\.0\.0\.1/);
  });
});
