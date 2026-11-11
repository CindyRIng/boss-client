/**
 * 应用服务层：对外能力的统一实现
 */
import { createHash } from 'node:crypto';
import type { Config } from './config/schema.js';
import type { CacheStore, SearchQueryRecord } from './cache/types.js';
import type { SessionManager } from './session/manager.js';
import type { Logger } from './utils/logger.js';
import { BossError } from './errors/catalog.js';
import type { Status, HealthResponse } from './domain/status.js';
import type { HealthValue } from './domain/status.js';
import type { JobDetail, JobSummary } from './domain/job.js';
import type { CompanyDetail, CompanyJob, CompanySummary } from './domain/company.js';
import type { SearchJobsRequest } from './domain/search.js';
import type { LoginCaptchaRequest, LoginSession, LoginStartRequest } from './domain/login.js';
import type { CacheClearResult, CacheStats } from './domain/cache.js';
import { mapCompanyDetail, mapCompanySummary, mapJobDetail, mapJobSummary } from './adapters/boss/mapper.js';
import { extractCompanyDetail, extractCompanyJobs } from './adapters/boss/extract.js';
import { CITY_SEED, flattenCities, type CitySeed } from './data/cities.js';
import { SCHEMA_VERSION } from './schemas/envelope.js';

export const VERSION = '0.1.0';

export interface CompaniesResponse {
  query: ReturnType<typeof queryToPublic>;
  companies: CompanySummary[];
  pagination: Pagination;
}

export interface JobsResponse {
  query: ReturnType<typeof queryToPublic>;
  jobs: JobSummary[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  pagesFetched: number;
  pagesAvailable: number;
}

export interface CitiesResponse {
  cities: Array<CitySeed & { isDefault: boolean }>;
  updatedAt: string;
}

export interface BossService {
  health(): Promise<HealthResponse>;
  status(): Promise<Status>;
  loginStart(req: LoginStartRequest): Promise<LoginSession>;
  loginGet(loginId: string): Promise<LoginSession>;
  loginCaptcha(loginId: string, answer: LoginCaptchaRequest): Promise<LoginSession>;
  loginSms(loginId: string, code: string): Promise<LoginSession>;
  loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }>;
  searchJobs(req: SearchJobsRequest): Promise<{ query: ReturnType<typeof queryToPublic>; jobs: JobSummary[]; companies: CompanySummary[]; pagination: Pagination }>;
  listJobs(req: { queryId: string; page: number; pageSize: number; refresh?: boolean }): Promise<JobsResponse>;
  jobDetail(req: { jobId: string; securityId?: string; lid?: string; refresh?: boolean }): Promise<JobDetail>;
  listCompanies(req: { queryId: string; page: number; pageSize: number; fetchPages?: number; refresh?: boolean }): Promise<CompaniesResponse>;
  companyDetail(req: { companyId: string; refresh?: boolean }): Promise<CompanyDetail>;
  companyJobs(req: { companyId: string; refresh?: boolean }): Promise<{ companyId: string; jobCount: number; jobs: CompanyJob[]; truncated: boolean }>;
  cities(refresh?: boolean): Promise<CitiesResponse>;
  cacheStats(): Promise<CacheStats>;
  cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<CacheClearResult>;
}

function queryToPublic(q: SearchQueryRecord): {
  queryId: string;
  keyword: string;
  cityCode: string;
  cityName?: string;
  pageSize: number;
  pagesFetched: number;
  resCount: number;
  totalCount: number;
  hasMore: boolean;
  fetchedAt: string;
} {
  return {
    queryId: q.queryId,
    keyword: q.keyword,
    cityCode: q.cityCode,
    ...(q.cityName ? { cityName: q.cityName } : {}),
    pageSize: q.pageSize,
    pagesFetched: q.pagesFetched,
    resCount: q.resCount,
    totalCount: q.totalCount,
    hasMore: q.hasMore,
    fetchedAt: new Date(q.fetchedAt).toISOString(),
  };
}

function newQueryId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `q_${ymd}_${Math.random().toString(36).slice(2, 8)}`;
}

function pagesAvailable(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(total / Math.max(1, pageSize)));
}

export class DefaultBossService implements BossService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly cfg: Config,
    private readonly session: SessionManager,
    private readonly cache: CacheStore,
    private readonly logger?: Logger,
  ) {}

  private cacheKey(...parts: unknown[]): string {
    return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
  }

  async health(): Promise<HealthResponse> {
    return {
      ok: true,
      service: 'boss-client',
      version: VERSION,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      schemaVersion: SCHEMA_VERSION,
      browser: {
        connected: this.session.isRunning(),
        headless: this.cfg.headless,
        profileDir: this.cfg.profileDir,
      },
      login: { loggedIn: await this.session.isLoggedIn().catch(() => false), health: (await this.session.status().catch(() => ({ health: 'stopped' as HealthValue }))).health },
      cache: { dbPath: this.cfg.cache.dbPath, ready: true },
      ts: new Date().toISOString(),
    };
  }

  async status(): Promise<Status> {
    try {
      await this.session.ensureStarted();
    } catch (err) {
      this.logger?.warn('status.start.failed', { message: String(err) });
    }
    const base = await this.session.status();
    const cache = await this.cache.stats();
    const req = this.session.requestStats();
    return {
      ...base,
      requests: {
        ...base.requests,
        cacheHits: cache.hits,
        cacheMisses: cache.misses,
        today: Math.max(base.requests.today, req.requests),
      },
      cache: { dbPath: cache.dbPath, ...(cache.sizeBytes !== undefined ? { sizeBytes: cache.sizeBytes } : {}), entries: { ...cache.entries } },
    };
  }

  async loginStart(req: LoginStartRequest): Promise<LoginSession> {
    return this.session.loginStart(req);
  }
  async loginGet(loginId: string): Promise<LoginSession> {
    return this.session.loginGet(loginId);
  }
  async loginCaptcha(loginId: string, answer: LoginCaptchaRequest): Promise<LoginSession> {
    return this.session.loginCaptcha(loginId, answer);
  }
  async loginSms(loginId: string, code: string): Promise<LoginSession> {
    return this.session.loginSms(loginId, code);
  }
  async loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }> {
    return this.session.loginCancel(loginId);
  }

  private async ensureLoggedIn(): Promise<void> {
    await this.session.ensureStarted();
    const info = await this.session.client().getUserInfo().catch(() => null);
    if (!info?.userId) throw new BossError('AUTH_REQUIRED', 'BOSS 登录态不可用，请执行 `boss login`');
  }

  async searchJobs(req: SearchJobsRequest): Promise<{ query: ReturnType<typeof queryToPublic>; jobs: JobSummary[]; companies: CompanySummary[]; pagination: Pagination }> {
    await this.ensureLoggedIn();
    const cityCode = req.cityCode ?? this.cfg.cities[0];
    if (!cityCode) throw new BossError('BAD_REQUEST', '缺少 cityCode');
    const key = this.cacheKey('search', req.keyword, cityCode, req.pageSize, req.page);
    if (!req.refresh) {
      const existing = this.cache.getQueryByCacheKey(key);
      if (existing && existing.pagesFetched >= req.pages) {
        const jobs = this.dedupeJobs(this.cache.getJobsByQuery(existing.queryId));
        const companies = this.dedupeCompanies(jobs);
        return {
          query: queryToPublic(existing),
          jobs,
          companies,
          pagination: {
            page: req.page,
            pageSize: req.pageSize,
            total: existing.resCount,
            hasMore: existing.hasMore,
            pagesFetched: existing.pagesFetched,
            pagesAvailable: pagesAvailable(existing.resCount, req.pageSize),
          },
        };
      }
    }
    const queryId = newQueryId();
    const fetchedJobs: JobSummary[] = [];
    const startPage = req.page;
    let resCount = 0;
    let totalCount = 0;
    let hasMore = false;
    let lid: string | undefined;
    for (let i = 0; i < req.pages; i += 1) {
      const page = startPage + i;
      if (i > 0) await this.session.client().pageDelayJitter();
      const raw = await this.session.client().searchJobs({ keyword: req.keyword, cityCode, page, pageSize: req.pageSize });
      resCount = Math.max(resCount, raw.resCount ?? 0);
      totalCount = Math.max(totalCount, raw.totalCount ?? 0);
      hasMore = Boolean(raw.hasMore);
      if (raw.lid) lid = raw.lid;
      const jobs = raw.jobList.map((row) => mapJobSummary(row, this.cfg.baseUrl));
      this.cache.putJobs(queryId, page, jobs);
      fetchedJobs.push(...jobs);
      this.logger?.debug('search.jobs.page', { keyword: req.keyword, cityCode, page, jobs: jobs.length });
      if (!hasMore) break;
    }
    void lid;
    const cityName = fetchedJobs[0]?.cityName;
    const record: SearchQueryRecord = {
      queryId,
      keyword: req.keyword,
      cityCode,
      ...(cityName ? { cityName } : {}),
      pageSize: req.pageSize,
      pagesFetched: Math.min(req.pages, Math.max(1, Math.ceil(fetchedJobs.length / req.pageSize))),
      resCount,
      totalCount,
      hasMore,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + this.cfg.cache.queryTtlSec * 1000,
    };
    this.cache.putQuery(record, key);
    const uniqueJobs = this.dedupeJobs(fetchedJobs);
    const companies = this.dedupeCompanies(uniqueJobs);
    for (const c of companies) this.cache.putCompanySummary(c);
    return {
      query: queryToPublic(record),
      jobs: uniqueJobs,
      companies,
      pagination: {
        page: req.page,
        pageSize: req.pageSize,
        total: resCount,
        hasMore,
        pagesFetched: record.pagesFetched,
        pagesAvailable: pagesAvailable(resCount, req.pageSize),
      },
    };
  }

  async listJobs(req: { queryId: string; page: number; pageSize: number; refresh?: boolean }): Promise<JobsResponse> {
    const record = this.cache.getQuery(req.queryId);
    if (!record) throw new BossError('QUERY_EXPIRED', `queryId 不存在或已过期：${req.queryId}`);
    await this.ensureLoggedIn();
    let cached = this.cache.getJobPage(req.queryId, req.page, this.cfg.cache.listTtlSec);
    if (!cached?.fresh || req.refresh) {
      const raw = await this.session.client().searchJobs({
        keyword: record.keyword,
        cityCode: record.cityCode,
        page: req.page,
        pageSize: req.pageSize,
      });
      const jobs = raw.jobList.map((row) => mapJobSummary(row, this.cfg.baseUrl));
      this.cache.putJobs(req.queryId, req.page, jobs);
      this.cache.updateQueryProgress(req.queryId, {
        pagesFetched: Math.max(record.pagesFetched, req.page),
        ...(raw.resCount !== undefined ? { resCount: Math.max(record.resCount, raw.resCount) } : {}),
        ...(raw.totalCount !== undefined ? { totalCount: Math.max(record.totalCount, raw.totalCount) } : {}),
        ...(raw.hasMore !== undefined ? { hasMore: raw.hasMore } : {}),
      });
      cached = { value: jobs, fetchedAt: Date.now(), expiresAt: Date.now(), fresh: true };
    }
    const updated = this.cache.getQuery(req.queryId) ?? record;
    return {
      query: queryToPublic(updated),
      jobs: cached!.value,
      pagination: {
        page: req.page,
        pageSize: req.pageSize,
        total: updated.resCount,
        hasMore: req.page < pagesAvailable(updated.resCount, req.pageSize),
        pagesFetched: updated.pagesFetched,
        pagesAvailable: pagesAvailable(updated.resCount, req.pageSize),
      },
    };
  }

  async jobDetail(req: { jobId: string; securityId?: string; lid?: string; refresh?: boolean }): Promise<JobDetail> {
    if (!req.refresh) {
      const cached = this.cache.getJobDetail(req.jobId, this.cfg.cache.jobDetailTtlSec);
      if (cached?.fresh) return cached.value;
    }
    await this.ensureLoggedIn();
    const securityId = req.securityId ?? (await this.session.client().resolveSecurityId(req.jobId));
    const raw = await this.session.client().getJobDetail({ securityId, ...(req.lid ? { lid: req.lid } : {}) });
    const detail = mapJobDetail(raw, req.jobId, this.cfg.baseUrl, securityId);
    this.cache.putJobDetail(detail);
    return detail;
  }

  async listCompanies(req: { queryId: string; page: number; pageSize: number; fetchPages?: number; refresh?: boolean }): Promise<CompaniesResponse> {
    let record = this.cache.getQuery(req.queryId);
    if (!record) throw new BossError('QUERY_EXPIRED', `queryId 不存在或已过期：${req.queryId}`);
    await this.ensureLoggedIn();
    if (req.fetchPages && req.fetchPages > 0) {
      const target = Math.min(this.cfg.session.maxPages, record.pagesFetched + req.fetchPages);
      for (let page = record.pagesFetched + 1; page <= target; page += 1) {
        await this.session.client().pageDelayJitter();
        const raw = await this.session.client().searchJobs({
          keyword: record.keyword,
          cityCode: record.cityCode,
          page,
          pageSize: record.pageSize,
        });
        const jobs = raw.jobList.map((row) => mapJobSummary(row, this.cfg.baseUrl));
        this.cache.putJobs(record.queryId, page, jobs);
        record = {
          ...record,
          pagesFetched: page,
          ...(raw.resCount !== undefined ? { resCount: Math.max(record.resCount, raw.resCount) } : {}),
          ...(raw.totalCount !== undefined ? { totalCount: Math.max(record.totalCount, raw.totalCount) } : {}),
          ...(raw.hasMore !== undefined ? { hasMore: raw.hasMore } : {}),
        };
        this.cache.updateQueryProgress(record.queryId, {
          pagesFetched: record.pagesFetched,
          resCount: record.resCount,
          totalCount: record.totalCount,
          hasMore: record.hasMore,
        });
        if (!raw.hasMore) break;
      }
    }
    const jobs = this.cache.getJobsByQuery(record.queryId);
    const all = this.dedupeCompanies(jobs);
    for (const c of all) this.cache.putCompanySummary(c);
    const total = all.length;
    const start = (req.page - 1) * req.pageSize;
    const companies = all.slice(start, start + req.pageSize);
    return {
      query: queryToPublic(record),
      companies,
      pagination: {
        page: req.page,
        pageSize: req.pageSize,
        total,
        hasMore: start + companies.length < total,
        pagesFetched: record.pagesFetched,
        pagesAvailable: pagesAvailable(record.resCount, record.pageSize),
      },
    };
  }

  async companyDetail(req: { companyId: string; refresh?: boolean }): Promise<CompanyDetail> {
    if (!req.refresh) {
      const cached = this.cache.getCompanyDetail(req.companyId, this.cfg.cache.companyTtlSec);
      if (cached?.fresh) return cached.value;
    }
    await this.ensureLoggedIn();
    const page = await this.session.client().getCompanyPage(req.companyId);
    const extracted = await extractCompanyDetail(page);
    const detail = mapCompanyDetail(extracted, req.companyId, this.cfg.baseUrl);
    this.cache.putCompanyDetail(detail);
    return detail;
  }

  async companyJobs(req: { companyId: string; refresh?: boolean }): Promise<{ companyId: string; jobCount: number; jobs: CompanyJob[]; truncated: boolean }> {
    if (!req.refresh) {
      const cached = this.cache.getCompanyJobs(req.companyId, this.cfg.cache.companyJobsTtlSec);
      if (cached?.fresh) return { companyId: req.companyId, jobCount: cached.value.length, jobs: cached.value, truncated: false };
    }
    await this.ensureLoggedIn();
    const page = await this.session.client().getCompanyJobsPage(req.companyId);
    const extracted = await extractCompanyJobs(page);
    this.cache.putCompanyJobs(req.companyId, extracted.jobs);
    return { companyId: req.companyId, jobCount: extracted.jobCount, jobs: extracted.jobs, truncated: extracted.truncated };
  }

  async cities(refresh = false): Promise<CitiesResponse> {
    const cached = this.cache.getMeta('cities');
    if (cached && !refresh) {
      try {
        const parsed = JSON.parse(cached) as { cities: CitySeed[]; updatedAt: string };
        return { cities: this.markDefaults(parsed.cities), updatedAt: parsed.updatedAt };
      } catch {
        /* fall through */
      }
    }
    let cities: CitySeed[] = CITY_SEED;
    if (refresh) {
      try {
        await this.ensureStarted();
        const raw = await this.session.client().getCities();
        const flat = flattenCities(raw);
        if (flat.length > 0) cities = flat;
      } catch (err) {
        this.logger?.warn('cities.refresh.failed', { message: String(err) });
      }
    }
    const updatedAt = new Date().toISOString();
    this.cache.putMeta('cities', JSON.stringify({ cities, updatedAt }));
    return { cities: this.markDefaults(cities), updatedAt };
  }

  private markDefaults(cities: CitySeed[]): Array<CitySeed & { isDefault: boolean }> {
    const defaults = new Set(this.cfg.cities);
    return cities.map((c) => ({ ...c, isDefault: defaults.has(c.cityCode) }));
  }

  private async ensureStarted(): Promise<void> {
    await this.session.ensureStarted();
  }

  private dedupeCompanies(jobs: JobSummary[]): CompanySummary[] {
    const map = new Map<string, JobSummary[]>();
    const seen = new Set<string>();
    for (const job of jobs) {
      const key = `${job.companyId}:${job.jobId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const arr = map.get(job.companyId) ?? [];
      arr.push(job);
      map.set(job.companyId, arr);
    }
    return [...map.entries()]
      .map(([companyId, list]) => mapCompanySummary(list, companyId))
      .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'zh-CN'));
  }

  private dedupeJobs(jobs: JobSummary[]): JobSummary[] {
    const seen = new Set<string>();
    return jobs.filter((j) => {
      if (seen.has(j.jobId)) return false;
      seen.add(j.jobId);
      return true;
    });
  }

  async cacheStats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  async cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<CacheClearResult> {
    const deleted = await this.cache.clear(opts);
    return { deleted, dbPath: this.cfg.cache.dbPath };
  }
}
