/**
 * 内存缓存（测试 / SQLite 不可用时回退）
 */
import type { CompanyDetail, CompanyJob, CompanySummary } from '../domain/company.js';
import type { JobDetail, JobSummary } from '../domain/job.js';
import type { CacheStats } from '../domain/cache.js';
import type { CacheStore, CachedValue, SearchQueryRecord } from './types.js';
import { cachedValue } from './types.js';

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class MemoryCacheStore implements CacheStore {
  readonly driver = 'memory' as const;
  private queries = new Map<string, SearchQueryRecord>();
  private queryKeys = new Map<string, string>();
  private jobPages = new Map<string, Entry<JobSummary[]>>();
  private jobDetails = new Map<string, Entry<JobDetail>>();
  private companies = new Map<string, Entry<CompanySummary>>();
  private companyDetails = new Map<string, Entry<CompanyDetail>>();
  private companyJobs = new Map<string, Entry<CompanyJob[]>>();
  private meta = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  getQuery(queryId: string): SearchQueryRecord | null {
    const q = this.queries.get(queryId) ?? null;
    if (!q) return null;
    return Date.now() <= q.expiresAt ? q : null;
  }

  getQueryByCacheKey(cacheKey: string): SearchQueryRecord | null {
    const id = this.queryKeys.get(cacheKey);
    if (!id) return null;
    return this.getQuery(id);
  }

  putQuery(record: SearchQueryRecord, cacheKey: string): void {
    this.queries.set(record.queryId, { ...record });
    this.queryKeys.set(cacheKey, record.queryId);
  }

  updateQueryProgress(queryId: string, patch: Partial<Pick<SearchQueryRecord, 'pagesFetched' | 'resCount' | 'totalCount' | 'hasMore'>>): void {
    const q = this.queries.get(queryId);
    if (q) Object.assign(q, patch);
  }

  getJobPage(queryId: string, page: number, ttlSec: number): CachedValue<JobSummary[]> | null {
    const e = this.jobPages.get(`${queryId}:${page}`);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  getJobsByQuery(queryId: string): JobSummary[] {
    const out: JobSummary[] = [];
    const prefix = `${queryId}:`;
    for (const [k, e] of this.jobPages) {
      if (k.startsWith(prefix)) out.push(...e.value);
    }
    return out;
  }

  putJobs(queryId: string, page: number, jobs: JobSummary[]): void {
    this.jobPages.set(`${queryId}:${page}`, { value: jobs, fetchedAt: Date.now() });
  }

  getJobDetail(jobId: string, ttlSec: number): CachedValue<JobDetail> | null {
    const e = this.jobDetails.get(jobId);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putJobDetail(detail: JobDetail): void {
    this.jobDetails.set(detail.jobId, { value: detail, fetchedAt: Date.now() });
  }

  getCompanySummary(companyId: string, ttlSec: number): CachedValue<CompanySummary> | null {
    const e = this.companies.get(companyId);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanySummary(company: CompanySummary): void {
    this.companies.set(company.companyId, { value: company, fetchedAt: Date.now() });
  }

  getCompanyDetail(companyId: string, ttlSec: number): CachedValue<CompanyDetail> | null {
    const e = this.companyDetails.get(companyId);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyDetail(detail: CompanyDetail): void {
    this.companyDetails.set(detail.companyId, { value: detail, fetchedAt: Date.now() });
  }

  getCompanyJobs(companyId: string, ttlSec: number): CachedValue<CompanyJob[]> | null {
    const e = this.companyJobs.get(companyId);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyJobs(companyId: string, jobs: CompanyJob[]): void {
    this.companyJobs.set(companyId, { value: jobs, fetchedAt: Date.now() });
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  putMeta(key: string, value: string): void {
    this.meta.set(key, value);
  }

  async stats(): Promise<CacheStats> {
    const jobs = [...this.jobPages.values()].reduce((n, e) => n + e.value.length, 0);
    const total = this.hits + this.misses;
    return {
      dbPath: ':memory:',
      driver: 'memory',
      entries: {
        queries: this.queries.size,
        jobs,
        jobDetails: this.jobDetails.size,
        companies: this.companies.size,
        companyDetails: this.companyDetails.size,
        companyJobs: this.companyJobs.size,
      },
      hits: this.hits,
      misses: this.misses,
      ...(total > 0 ? { hitRate: this.hits / total } : {}),
    };
  }

  async clear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<number> {
    if (opts.scope === 'expired') {
      const now = Date.now();
      let n = 0;
      for (const [k, q] of this.queries) {
        if (q.expiresAt < now) {
          this.queries.delete(k);
          n++;
        }
      }
      return n;
    }
    if (opts.prefix) {
      let n = 0;
      for (const k of [...this.queries.keys()]) if (k.startsWith(opts.prefix)) { this.queries.delete(k); n++; }
      for (const k of [...this.jobPages.keys()]) if (k.startsWith(opts.prefix)) { this.jobPages.delete(k); n++; }
      for (const k of [...this.jobDetails.keys()]) if (k.startsWith(opts.prefix)) { this.jobDetails.delete(k); n++; }
      for (const k of [...this.companies.keys()]) if (k.startsWith(opts.prefix)) { this.companies.delete(k); n++; }
      for (const k of [...this.companyDetails.keys()]) if (k.startsWith(opts.prefix)) { this.companyDetails.delete(k); n++; }
      for (const k of [...this.companyJobs.keys()]) if (k.startsWith(opts.prefix)) { this.companyJobs.delete(k); n++; }
      return n;
    }
    const n =
      this.queries.size +
      this.jobPages.size +
      this.jobDetails.size +
      this.companies.size +
      this.companyDetails.size +
      this.companyJobs.size;
    this.queries.clear();
    this.queryKeys.clear();
    this.jobPages.clear();
    this.jobDetails.clear();
    this.companies.clear();
    this.companyDetails.clear();
    this.companyJobs.clear();
    this.meta.clear();
    return n;
  }
}
