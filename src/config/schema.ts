/**
 * 运行配置（env > defaults；支持 ~/.boss-client/config.json 可选项）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { BossError } from '../errors/catalog.js';

export const VERSION = '0.1.0';

function home(): string {
  return process.env.HOME || os.homedir();
}

export function expandHome(p: string): string {
  if (p === '~') return home();
  if (p.startsWith('~/')) return path.join(home(), p.slice(2));
  return p;
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}
function optStr(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}
function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new BossError('BAD_REQUEST', `${key} must be boolean`);
}
function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^\d+$/.test(v)) throw new BossError('BAD_REQUEST', `${key} must be an integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new BossError('BAD_REQUEST', `${key} out of range`);
  return n;
}

export const ConfigSchema = z
  .object({
    baseUrl: z.string().url(),
    loginUrl: z.string().url(),
    phone: z.string().optional(),
    profileDir: z.string(),
    headless: z.boolean(),
    apiToken: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    cache: z.object({
      dbPath: z.string(),
      queryTtlSec: z.number().int().nonnegative(),
      listTtlSec: z.number().int().nonnegative(),
      jobDetailTtlSec: z.number().int().nonnegative(),
      companyTtlSec: z.number().int().nonnegative(),
      companyJobsTtlSec: z.number().int().nonnegative(),
    }),
    session: z.object({
      heartbeatSec: z.number().int().positive(),
      ratePerMin: z.number().int().nonnegative(),
      maxPages: z.number().int().positive().max(5),
      pageDelayMs: z.number().int().nonnegative(),
      code37CooldownSec: z.number().int().nonnegative(),
      requestTimeoutMs: z.number().int().positive(),
      loginTimeoutSec: z.number().int().positive(),
    }),
    cities: z.array(z.string().regex(/^\d{6,12}$/)),
    log: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      file: z.string(),
      maxBytes: z.number().int().positive(),
      keep: z.number().int().positive(),
      stdout: z.boolean(),
    }),
  })
  .meta({ id: 'BossConfig' });

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const dataDir = expandHome(str(env, 'BOSS_DATA_DIR', '~/.boss-client'));
  const cfg: Config = {
    baseUrl: str(env, 'BOSS_BASE_URL', 'https://www.zhipin.com').replace(/\/+$/, ''),
    loginUrl: str(
      env,
      'BOSS_LOGIN_URL',
      'https://www.zhipin.com/web/user/?from=passport-zp&fromUrl=https%3A%2F%2Fwww.zhipin.com%2F',
    ),
    phone: optStr(env, 'BOSS_PHONE'),
    profileDir: expandHome(str(env, 'BOSS_PROFILE_DIR', path.join(dataDir, 'profile'))),
    headless: bool(env, 'BOSS_HEADLESS', false),
    apiToken: str(env, 'BOSS_API_TOKEN', 'change-me'),
    host: str(env, 'BOSS_HOST', '127.0.0.1'),
    port: int(env, 'BOSS_PORT', 8788, 1),
    cache: {
      dbPath: expandHome(str(env, 'BOSS_CACHE_DB', path.join(dataDir, 'cache.db'))),
      queryTtlSec: int(env, 'BOSS_CACHE_QUERY_TTL', 86400),
      listTtlSec: int(env, 'BOSS_CACHE_LIST_TTL', 7200),
      jobDetailTtlSec: int(env, 'BOSS_CACHE_JOB_DETAIL_TTL', 43200),
      companyTtlSec: int(env, 'BOSS_CACHE_COMPANY_TTL', 604800),
      companyJobsTtlSec: int(env, 'BOSS_CACHE_COMPANY_JOBS_TTL', 7200),
    },
    session: {
      heartbeatSec: int(env, 'BOSS_HEARTBEAT_SEC', 300, 30),
      ratePerMin: int(env, 'BOSS_RATE_PER_MIN', 12),
      maxPages: int(env, 'BOSS_MAX_PAGES', 5, 1),
      pageDelayMs: int(env, 'BOSS_PAGE_DELAY_MS', 2500),
      code37CooldownSec: int(env, 'BOSS_CODE37_COOLDOWN_SEC', 60),
      requestTimeoutMs: int(env, 'BOSS_REQUEST_TIMEOUT_MS', 30000, 1000),
      loginTimeoutSec: int(env, 'BOSS_LOGIN_TIMEOUT_SEC', 600, 60),
    },
    cities: str(env, 'BOSS_CITIES', '101090100')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    log: {
      level: (str(env, 'BOSS_LOG_LEVEL', 'info') as Config['log']['level']),
      file: expandHome(str(env, 'BOSS_LOG_FILE', path.join(dataDir, 'logs/boss.log'))),
      maxBytes: int(env, 'BOSS_LOG_MAX_BYTES', 10 * 1024 * 1024, 1024),
      keep: int(env, 'BOSS_LOG_KEEP', 5, 1),
      stdout: bool(env, 'BOSS_LOG_STDOUT', true),
    },
  };
  if (cfg.session.maxPages > 5) throw new BossError('BAD_REQUEST', 'BOSS_MAX_PAGES max is 5');
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    throw new BossError('BAD_REQUEST', 'BOSS_HOST must be 127.0.0.1 (local only)');
  }
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) throw new BossError('BAD_REQUEST', 'invalid config', { details: { issues: parsed.error.issues } });
  return parsed.data;
}

export function ensureDataDirs(cfg: Config): void {
  fs.mkdirSync(path.dirname(cfg.profileDir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.cache.dbPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.log.file), { recursive: true, mode: 0o700 });
}

export function loadDotEnv(file = process.env.BOSS_ENV_FILE ?? path.join(process.cwd(), '.env')): void {
  const target = expandHome(file);
  if (!fs.existsSync(target)) return;
  try {
    const text = fs.readFileSync(target, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* .env is optional */
  }
}
