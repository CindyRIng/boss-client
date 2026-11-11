/**
 * 缓存接口与数据类型
 */
import type { JobDetail, JobSummary } from '../domain/job.js';
import type { CompanyDetail, CompanyJob, CompanySummary } from '../domain/company.js';
import type { CacheStats } from '../domain/cache.js';

export interface CachedValue<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  fresh: boolean;
}

export interface SearchQueryRecord {
  queryId: string;
  keyword: string;
  cityCode: string;
  cityName?: string;
  pageSize: number;
  pagesFetched: number;
  resCount: number;
  totalCount: number;
  hasMore: boolean;
  fetchedAt: number;
  expiresAt: number;
}

export interface CacheStore {
  readonly driver: 'sqlite' | 'memory';
  init(): Promise<void>;
  close(): Promise<void>;

  getQuery(queryId: string): SearchQueryRecord | null;
  getQueryByCacheKey(cacheKey: string): SearchQueryRecord | null;
  putQuery(record: SearchQueryRecord, cacheKey: string): void;
  updateQueryProgress(queryId: string, patch: Partial<Pick<SearchQueryRecord, 'pagesFetched' | 'resCount' | 'totalCount' | 'hasMore'>>): void;

  getJobPage(queryId: string, page: number, ttlSec: number): CachedValue<JobSummary[]> | null;
  getJobsByQuery(queryId: string): JobSummary[];
  putJobs(queryId: string, page: number, jobs: JobSummary[]): void;

  getJobDetail(jobId: string, ttlSec: number): CachedValue<JobDetail> | null;
  putJobDetail(detail: JobDetail): void;

  getCompanySummary(companyId: string, ttlSec: number): CachedValue<CompanySummary> | null;
  putCompanySummary(company: CompanySummary): void;

  getCompanyDetail(companyId: string, ttlSec: number): CachedValue<CompanyDetail> | null;
  putCompanyDetail(detail: CompanyDetail): void;

  getCompanyJobs(companyId: string, ttlSec: number): CachedValue<CompanyJob[]> | null;
  putCompanyJobs(companyId: string, jobs: CompanyJob[]): void;

  getMeta(key: string): string | null;
  putMeta(key: string, value: string): void;

  stats(): Promise<CacheStats>;
  clear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<number>;
}

export function cachedValue<T>(value: T, fetchedAt: number, ttlSec: number): CachedValue<T> {
  const expiresAt = fetchedAt + ttlSec * 1000;
  return { value, fetchedAt, expiresAt, fresh: Date.now() < expiresAt };
}
