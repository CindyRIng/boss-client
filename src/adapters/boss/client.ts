/**
 * BOSS 页面内 API 客户端：所有请求在已登录页面上下文中 fetch（保持 cookie/指纹）
 */
import type { Page } from 'playwright-core';
import { BossError } from '../../errors/catalog.js';
import { BOSS_ENDPOINTS, companyJobsUrl, companyUrl, jobUrl, searchPageUrl } from './endpoints.js';
import { RateLimiter, sleep } from './rate-limiter.js';
import {
  RawAccountStatusDataSchema,
  RawJobDetailDataSchema,
  RawJobListDataSchema,
  RawUserInfoDataSchema,
  assertBossEnvelope,
  parseZpData,
  type RawJobDetailData,
  type RawJobListData,
} from './raw.js';

export interface BossApiConfig {
  baseUrl: string;
  timeoutMs: number;
  ratePerMin: number;
  pageJitterMs?: number;
}

interface RawHttpResult {
  status: number;
  text: string;
  json: unknown;
}

export interface BossRequestStats {
  requests: number;
  lastUpstreamAt?: number;
  code37Count: number;
  cooldownUntil?: number;
  lastError?: string;
}

export class PageBossApiClient {
  private readonly limiter: RateLimiter;
  private requests = 0;
  private lastUpstreamAt: number | undefined;
  private code37Count = 0;
  private cooldownUntil: number | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly page: Page,
    private readonly cfg: BossApiConfig,
  ) {
    this.limiter = new RateLimiter(cfg.ratePerMin, cfg.pageJitterMs ?? 0);
  }

  stats(): BossRequestStats {
    return {
      requests: this.requests,
      ...(this.lastUpstreamAt ? { lastUpstreamAt: this.lastUpstreamAt } : {}),
      code37Count: this.code37Count,
      ...(this.cooldownUntil ? { cooldownUntil: this.cooldownUntil } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  remainingCooldownMs(): number {
    return this.cooldownUntil ? Math.max(0, this.cooldownUntil - Date.now()) : 0;
  }

  private assertNotCoolingDown(): void {
    const remain = this.remainingCooldownMs();
    if (remain > 0) {
      throw new BossError('RATE_LIMITED', `BOSS 风控冷却中，请 ${Math.ceil(remain / 1000)}s 后重试`, {
        retryAfterMs: remain,
      });
    }
  }

  private markCode37(cooldownSec: number): void {
    this.code37Count++;
    this.cooldownUntil = Date.now() + Math.max(1, cooldownSec) * 1000;
  }

  async ensureOrigin(): Promise<void> {
    const url = this.page.url();
    if (url.startsWith(this.cfg.baseUrl)) return;
    await this.page.goto(this.cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
    await this.page.waitForTimeout(1500);
  }

  private async rawHttp(
    path: string,
    opts: { method: 'GET' | 'POST'; query?: Record<string, string | undefined>; form?: Record<string, string> },
  ): Promise<RawHttpResult> {
    await this.limiter.acquire();
    this.assertNotCoolingDown();
    const url = new URL(path, this.cfg.baseUrl).toString();
    const result = await this.page.evaluate(
      async (raw) => {
        const req = raw as {
          url: string;
          method: string;
          query: Record<string, string | undefined>;
          form: Record<string, string> | null;
          timeoutMs: number;
        };
        const u = new URL(req.url);
        for (const [k, v] of Object.entries(req.query ?? {})) {
          if (v !== undefined && v !== '') u.searchParams.set(k, v);
        }
        const headers: Record<string, string> = {
          accept: 'application/json, text/plain, */*',
          'x-requested-with': 'XMLHttpRequest',
          referer: location.href,
        };
        const init: RequestInit = { method: req.method, credentials: 'include', headers };
        if (req.form) {
          headers['content-type'] = 'application/x-www-form-urlencoded';
          init.body = new URLSearchParams(req.form).toString();
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), req.timeoutMs);
        try {
          const r = await fetch(u.toString(), { ...init, signal: controller.signal });
          const text = await r.text();
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          return { status: r.status, text: text.slice(0, 5000), json };
        } finally {
          clearTimeout(timer);
        }
      },
      {
        url,
        method: opts.method,
        query: opts.query ?? {},
        form: opts.form ?? null,
        timeoutMs: this.cfg.timeoutMs,
      },
    );

    this.requests++;
    this.lastUpstreamAt = Date.now();
    const out = result as RawHttpResult;
    if (out.status === 401) throw new BossError('AUTH_REQUIRED', 'BOSS 登录态失效，需要重新登录');
    if (out.status === 403) throw new BossError('FORBIDDEN', 'BOSS 接口拒绝访问（风控/无权限）');
    if (out.status === 429) throw new BossError('RATE_LIMITED', 'BOSS 限流', { retryAfterMs: 60_000 });
    if (out.status >= 500) {
      throw new BossError('UPSTREAM_UNAVAILABLE', `BOSS 接口异常 HTTP ${out.status}`, { details: { body: out.text.slice(0, 500) } });
    }
    if (out.json === null) {
      throw new BossError('UPSTREAM_CHANGED', 'BOSS 返回非 JSON', { details: { status: out.status, body: out.text.slice(0, 500) } });
    }
    return out;
  }

  private async request<T>(
    path: string,
    opts: { method: 'GET' | 'POST'; query?: Record<string, string | undefined>; form?: Record<string, string> },
    parse: (json: unknown) => T,
  ): Promise<T> {
    try {
      const out = await this.rawHttp(path, opts);
      return parse(out.json);
    } catch (err) {
      const e = err instanceof BossError ? err : new BossError('UPSTREAM_UNAVAILABLE', String(err), { cause: err });
      this.lastError = e.message;
      if (e.code === 'UPSTREAM_BLOCKED') {
        this.markCode37(60);
        throw new BossError('UPSTREAM_BLOCKED', e.message, {
          details: { ...(e.details ?? {}), cooldownUntil: this.cooldownUntil },
        });
      }
      throw e;
    }
  }

  async searchJobs(params: { keyword: string; cityCode: string; page: number; pageSize: number }): Promise<RawJobListData> {
    await this.ensureOrigin();
    const pageUrl = searchPageUrl(this.cfg.baseUrl, params.keyword, params.cityCode);
    if (!this.page.url().startsWith(pageUrl)) {
      await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
      await this.page.waitForTimeout(2500);
    }
    return this.request(
      BOSS_ENDPOINTS.searchApi,
      {
        method: 'POST',
        query: { _: String(Date.now()) },
        form: {
          page: String(params.page),
          pageSize: String(params.pageSize),
          city: params.cityCode,
          query: params.keyword,
          expectInfo: '',
          multiSubway: '',
          multiBusinessDistrict: '',
          position: '',
          jobType: '',
          salary: '',
          experience: '',
          degree: '',
          industry: '',
          scale: '',
          stage: '',
          scene: '1',
          encryptExpectId: '',
        },
      },
      (json) => parseZpData(assertBossEnvelope(json, '搜索'), RawJobListDataSchema, '搜索'),
    );
  }

  async getJobDetail(params: { securityId: string; lid?: string }): Promise<RawJobDetailData> {
    await this.ensureOrigin();
    return this.request(
      BOSS_ENDPOINTS.jobDetailApi,
      {
        method: 'GET',
        query: {
          securityId: params.securityId,
          ...(params.lid ? { lid: params.lid } : {}),
          _: String(Date.now()),
        },
      },
      (json) => parseZpData(assertBossEnvelope(json, '岗位详情'), RawJobDetailDataSchema, '岗位详情'),
    );
  }

  async resolveSecurityId(jobId: string): Promise<string> {
    await this.ensureOrigin();
    const url = jobUrl(this.cfg.baseUrl, jobId);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
    await this.page.waitForTimeout(2000);
    const html = await this.page.content();
    const patterns = [
      /securityId\s*[:=]\s*['"]([^'"]{16,4096})['"]/,
      /securityId=([A-Za-z0-9_~\-.]{16,4096})/,
    ];
    for (const re of patterns) {
      const m = re.exec(html);
      if (m?.[1]) return decodeURIComponent(m[1]);
    }
    throw new BossError('UPSTREAM_CHANGED', '岗位详情页未找到 securityId，可能是页面改版', { details: { jobId } });
  }

  async getUserInfo(): Promise<{ userId?: string; name?: string; isHunter?: boolean } | null> {
    await this.ensureOrigin();
    try {
      const out = await this.rawHttp(BOSS_ENDPOINTS.userInfoApi, { method: 'GET', query: { _: String(Date.now()) } });
      const env = assertBossEnvelope(out.json, '用户信息');
      const data = parseZpData(env, RawUserInfoDataSchema, '用户信息');
      return {
        ...(data.userId !== undefined ? { userId: String(data.userId) } : {}),
        ...(data.name ? { name: data.name } : data.showName ? { name: data.showName } : {}),
        ...(data.isHunter !== undefined ? { isHunter: data.isHunter } : {}),
      };
    } catch (err) {
      if (err instanceof BossError && (err.code === 'AUTH_REQUIRED' || err.code === 'UPSTREAM_BLOCKED')) return null;
      throw err;
    }
  }

  async getAccountStatus(): Promise<unknown> {
    await this.ensureOrigin();
    const out = await this.rawHttp(BOSS_ENDPOINTS.accountStatusApi, { method: 'GET' });
    const env = assertBossEnvelope(out.json, '账号状态');
    return parseZpData(env, RawAccountStatusDataSchema, '账号状态');
  }

  async getCities(): Promise<unknown> {
    await this.ensureOrigin();
    const out = await this.rawHttp(BOSS_ENDPOINTS.cityGroupApi, { method: 'GET' });
    return out.json;
  }

  async getCompanyPage(companyId: string): Promise<Page> {
    await this.ensureOrigin();
    await this.page.goto(companyUrl(this.cfg.baseUrl, companyId), { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return this.page;
  }

  async getCompanyJobsPage(companyId: string): Promise<Page> {
    await this.ensureOrigin();
    await this.page.goto(companyJobsUrl(this.cfg.baseUrl, companyId), { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
    await this.page.waitForTimeout(2500);
    return this.page;
  }

  async pageDelayJitter(): Promise<void> {
    const base = 2500;
    await sleep(base + Math.floor(Math.random() * 1500));
  }
}
