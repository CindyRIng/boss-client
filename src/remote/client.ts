/**
 * 远程客户端：当 BOSS_CLIENT_URL 指向已运行的 REST 服务时，CLI/MCP 通过 HTTP 调用，
 * 避免与 systemd 常驻进程争抢同一 profile 锁。
 */
import type { Config } from '../config/schema.js';
import type { BossService } from '../service.js';
import type { LoginCaptchaRequest, LoginSession, LoginStartRequest } from '../domain/login.js';
import type { SearchJobsRequest } from '../domain/search.js';
import type { JobDetail } from '../domain/job.js';
import { BossError, type ErrorCode } from '../errors/catalog.js';

type Query = Record<string, string | number | boolean | undefined>;

export class RemoteBossClient implements BossService {
  private readonly baseUrl: string;

  constructor(
    private readonly cfg: Config,
    baseUrl?: string,
  ) {
    const url = baseUrl ?? process.env.BOSS_CLIENT_URL;
    if (!url) throw new BossError('BAD_REQUEST', 'BOSS_CLIENT_URL 未设置');
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private url(path: string, query: Query = {}): string {
    const u = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const target = this.url(path, opts.query);
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiToken}`,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(this.cfg.session.requestTimeoutMs + 30_000),
      });
    } catch (err) {
      throw new BossError('SERVICE_UNAVAILABLE', `无法连接 boss-client 常驻服务：${this.baseUrl}（请先启动 serve，或使用 boss mcp --local）`, { cause: err });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BossError('UPSTREAM_CHANGED', `boss-client REST 返回非 JSON（HTTP ${response.status}）`);
    }
    const env = payload as { ok?: boolean; data?: T; error?: { code: ErrorCode; message: string; retryAfterMs?: number; details?: Record<string, unknown> } };
    if (env?.ok && env.data !== undefined) return env.data;
    const err = env?.error;
    throw new BossError(err?.code ?? 'INTERNAL', err?.message ?? `boss-client REST HTTP ${response.status}`, {
      ...(err?.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
      ...(err?.details ? { details: err.details } : {}),
    });
  }

  health() {
    return this.request<Awaited<ReturnType<BossService['health']>>>('GET', '/v1/health');
  }
  status() {
    return this.request<Awaited<ReturnType<BossService['status']>>>('GET', '/v1/status');
  }
  loginStart(req: LoginStartRequest) {
    return this.request<LoginSession>('POST', '/v1/session/login', { body: req });
  }
  loginGet(loginId: string) {
    return this.request<LoginSession>('GET', `/v1/session/login/${encodeURIComponent(loginId)}`);
  }
  loginCaptcha(loginId: string, answer: LoginCaptchaRequest) {
    return this.request<LoginSession>('POST', `/v1/session/login/${encodeURIComponent(loginId)}/captcha`, { body: answer });
  }
  loginSms(loginId: string, code: string) {
    return this.request<LoginSession>('POST', `/v1/session/login/${encodeURIComponent(loginId)}/sms`, { body: { code } });
  }
  loginCancel(loginId: string) {
    return this.request<{ loginId: string; state: 'cancelled' }>('DELETE', `/v1/session/login/${encodeURIComponent(loginId)}`);
  }
  searchJobs(req: SearchJobsRequest) {
    return this.request<Awaited<ReturnType<BossService['searchJobs']>>>('POST', '/v1/search/jobs', { body: req });
  }
  listJobs(req: { queryId: string; page: number; pageSize: number; refresh?: boolean }) {
    return this.request<Awaited<ReturnType<BossService['listJobs']>>>('GET', '/v1/jobs', {
      query: { queryId: req.queryId, page: req.page, pageSize: req.pageSize, refresh: req.refresh },
    });
  }
  jobDetail(req: { jobId: string; securityId?: string; lid?: string; refresh?: boolean }) {
    return this.request<JobDetail>('GET', `/v1/jobs/${encodeURIComponent(req.jobId)}`, {
      query: { securityId: req.securityId, lid: req.lid, refresh: req.refresh },
    });
  }
  listCompanies(req: { queryId: string; page: number; pageSize: number; fetchPages?: number; refresh?: boolean }) {
    return this.request<Awaited<ReturnType<BossService['listCompanies']>>>('GET', '/v1/companies', {
      query: { queryId: req.queryId, page: req.page, pageSize: req.pageSize, fetchPages: req.fetchPages, refresh: req.refresh },
    });
  }
  companyDetail(req: { companyId: string; refresh?: boolean }) {
    return this.request<Awaited<ReturnType<BossService['companyDetail']>>>('GET', `/v1/companies/${encodeURIComponent(req.companyId)}`, {
      query: { refresh: req.refresh },
    });
  }
  companyJobs(req: { companyId: string; refresh?: boolean }) {
    return this.request<Awaited<ReturnType<BossService['companyJobs']>>>('GET', `/v1/companies/${encodeURIComponent(req.companyId)}/jobs`, {
      query: { refresh: req.refresh },
    });
  }
  cities(refresh?: boolean) {
    return this.request<Awaited<ReturnType<BossService['cities']>>>('GET', '/v1/cities', { query: { refresh } });
  }
  cacheStats() {
    return this.request<Awaited<ReturnType<BossService['cacheStats']>>>('GET', '/v1/cache/stats');
  }
  cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }) {
    return this.request<Awaited<ReturnType<BossService['cacheClear']>>>('DELETE', '/v1/cache', {
      query: { scope: opts.scope, prefix: opts.prefix },
    });
  }
}
