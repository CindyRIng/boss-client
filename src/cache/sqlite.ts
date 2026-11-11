/**
 * SQLite 缓存（Node 22 内置 node:sqlite）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { CompanyDetail, CompanyJob, CompanySummary } from '../domain/company.js';
import type { JobDetail, JobSummary } from '../domain/job.js';
import type { CacheStats } from '../domain/cache.js';
import { BossError } from '../errors/catalog.js';
import type { CacheStore, CachedValue, SearchQueryRecord } from './types.js';
import { cachedValue } from './types.js';

const require = createRequire(import.meta.url);

interface Stmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (file: string) => Db;
}

function loadSqlite(): SqliteModule {
  try {
    return require('node:sqlite') as SqliteModule;
  } catch (err) {
    throw new BossError('CACHE_ERROR', 'node:sqlite 不可用（需要 Node >= 22.5）', { cause: err });
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS queries (
  query_id TEXT PRIMARY KEY,
  cache_key TEXT UNIQUE,
  keyword TEXT NOT NULL,
  city_code TEXT NOT NULL,
  city_name TEXT,
  page_size INTEGER NOT NULL,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  res_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  has_more INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  query_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  position INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (query_id, page, job_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_query ON jobs(query_id, page, position);
CREATE TABLE IF NOT EXISTS job_details (
  job_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS company_details (
  company_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS company_jobs (
  company_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function rowToQuery(row: Record<string, unknown>): SearchQueryRecord {
  return {
    queryId: String(row.query_id),
    keyword: String(row.keyword),
    cityCode: String(row.city_code),
    cityName: row.city_name ? String(row.city_name) : undefined,
    pageSize: Number(row.page_size),
    pagesFetched: Number(row.pages_fetched),
    resCount: Number(row.res_count),
    totalCount: Number(row.total_count),
    hasMore: Number(row.has_more) === 1,
    fetchedAt: Number(row.fetched_at),
    expiresAt: Number(row.expires_at),
  };
}

export class SqliteCacheStore implements CacheStore {
  readonly driver = 'sqlite' as const;
  private db: Db | null = null;
  private hits = 0;
  private misses = 0;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    if (this.db) return;
    if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.db.exec(DDL);
  }

  private get conn(): Db {
    if (!this.db) throw new BossError('CACHE_ERROR', 'cache store not initialized');
    return this.db;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  getQuery(queryId: string): SearchQueryRecord | null {
    const row = this.conn.prepare('SELECT * FROM queries WHERE query_id = ?').get(queryId);
    if (!row) return null;
    const q = rowToQuery(row);
    return Date.now() <= q.expiresAt ? q : null;
  }

  getQueryByCacheKey(cacheKey: string): SearchQueryRecord | null {
    const row = this.conn.prepare('SELECT * FROM queries WHERE cache_key = ?').get(cacheKey);
    if (!row) return null;
    const q = rowToQuery(row);
    return Date.now() <= q.expiresAt ? q : null;
  }

  putQuery(record: SearchQueryRecord, cacheKey: string): void {
    this.conn.prepare('DELETE FROM queries WHERE cache_key = ? AND query_id <> ?').run(cacheKey, record.queryId);
    this.conn
      .prepare(
        `INSERT OR REPLACE INTO queries
         (query_id, cache_key, keyword, city_code, city_name, page_size, pages_fetched, res_count, total_count, has_more, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.queryId,
        cacheKey,
        record.keyword,
        record.cityCode,
        record.cityName ?? null,
        record.pageSize,
        record.pagesFetched,
        record.resCount,
        record.totalCount,
        record.hasMore ? 1 : 0,
        record.fetchedAt,
        record.expiresAt,
      );
  }

  updateQueryProgress(queryId: string, patch: Partial<Pick<SearchQueryRecord, 'pagesFetched' | 'resCount' | 'totalCount' | 'hasMore'>>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.pagesFetched !== undefined) { sets.push('pages_fetched = ?'); vals.push(patch.pagesFetched); }
    if (patch.resCount !== undefined) { sets.push('res_count = ?'); vals.push(patch.resCount); }
    if (patch.totalCount !== undefined) { sets.push('total_count = ?'); vals.push(patch.totalCount); }
    if (patch.hasMore !== undefined) { sets.push('has_more = ?'); vals.push(patch.hasMore ? 1 : 0); }
    if (!sets.length) return;
    this.conn.prepare(`UPDATE queries SET ${sets.join(', ')} WHERE query_id = ?`).run(...vals, queryId);
  }

  getJobPage(queryId: string, page: number, ttlSec: number): CachedValue<JobSummary[]> | null {
    const rows = this.conn
      .prepare('SELECT json, fetched_at FROM jobs WHERE query_id = ? AND page = ? ORDER BY position ASC')
      .all(queryId, page);
    if (!rows.length) {
      this.misses++;
      return null;
    }
    const fetchedAt = Math.max(...rows.map((r) => Number(r.fetched_at)));
    const v = cachedValue(rows.map((r) => JSON.parse(String(r.json)) as JobSummary), fetchedAt, ttlSec);
    v.fresh ? this.hits++ : this.misses++;
    return v;
  }

  getJobsByQuery(queryId: string): JobSummary[] {
    const rows = this.conn.prepare('SELECT json FROM jobs WHERE query_id = ? ORDER BY page ASC, position ASC').all(queryId);
    return rows.map((r) => JSON.parse(String(r.json)) as JobSummary);
  }

  putJobs(queryId: string, page: number, jobs: JobSummary[]): void {
    this.conn.prepare('DELETE FROM jobs WHERE query_id = ? AND page = ?').run(queryId, page);
    const stmt = this.conn.prepare('INSERT OR REPLACE INTO jobs (query_id, page, position, job_id, json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)');
    jobs.forEach((job, i) => stmt.run(queryId, page, i, job.jobId, JSON.stringify(job), Date.now()));
  }

  getJobDetail(jobId: string, ttlSec: number): CachedValue<JobDetail> | null {
    const row = this.conn.prepare('SELECT json, fetched_at FROM job_details WHERE job_id = ?').get(jobId);
    const v = row ? cachedValue(JSON.parse(String(row.json)) as JobDetail, Number(row.fetched_at), ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putJobDetail(detail: JobDetail): void {
    this.conn
      .prepare('INSERT OR REPLACE INTO job_details (job_id, json, fetched_at) VALUES (?, ?, ?)')
      .run(detail.jobId, JSON.stringify(detail), Date.now());
  }

  getCompanySummary(companyId: string, ttlSec: number): CachedValue<CompanySummary> | null {
    const row = this.conn.prepare('SELECT json, fetched_at FROM companies WHERE company_id = ?').get(companyId);
    const v = row ? cachedValue(JSON.parse(String(row.json)) as CompanySummary, Number(row.fetched_at), ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanySummary(company: CompanySummary): void {
    this.conn
      .prepare('INSERT OR REPLACE INTO companies (company_id, json, fetched_at) VALUES (?, ?, ?)')
      .run(company.companyId, JSON.stringify(company), Date.now());
  }

  getCompanyDetail(companyId: string, ttlSec: number): CachedValue<CompanyDetail> | null {
    const row = this.conn.prepare('SELECT json, fetched_at FROM company_details WHERE company_id = ?').get(companyId);
    const v = row ? cachedValue(JSON.parse(String(row.json)) as CompanyDetail, Number(row.fetched_at), ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyDetail(detail: CompanyDetail): void {
    this.conn
      .prepare('INSERT OR REPLACE INTO company_details (company_id, json, fetched_at) VALUES (?, ?, ?)')
      .run(detail.companyId, JSON.stringify(detail), Date.now());
  }

  getCompanyJobs(companyId: string, ttlSec: number): CachedValue<CompanyJob[]> | null {
    const row = this.conn.prepare('SELECT json, fetched_at FROM company_jobs WHERE company_id = ?').get(companyId);
    const v = row ? cachedValue(JSON.parse(String(row.json)) as CompanyJob[], Number(row.fetched_at), ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyJobs(companyId: string, jobs: CompanyJob[]): void {
    this.conn
      .prepare('INSERT OR REPLACE INTO company_jobs (company_id, json, fetched_at) VALUES (?, ?, ?)')
      .run(companyId, JSON.stringify(jobs), Date.now());
  }

  getMeta(key: string): string | null {
    const row = this.conn.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? String(row.value) : null;
  }

  putMeta(key: string, value: string): void {
    this.conn.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  async stats(): Promise<CacheStats> {
    const count = (table: string) => Number((this.conn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c);
    const bounds = this.conn
      .prepare('SELECT MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest FROM jobs')
      .get() as { oldest: number | null; newest: number | null };
    let sizeBytes: number | undefined;
    if (this.dbPath !== ':memory:') {
      const files = [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`];
      const sizes = files.filter((f) => fs.existsSync(f)).map((f) => fs.statSync(f).size);
      if (sizes.length) sizeBytes = sizes.reduce((a, b) => a + b, 0);
    }
    const total = this.hits + this.misses;
    return {
      dbPath: this.dbPath,
      driver: 'sqlite',
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      entries: {
        queries: count('queries'),
        jobs: count('jobs'),
        jobDetails: count('job_details'),
        companies: count('companies'),
        companyDetails: count('company_details'),
        companyJobs: count('company_jobs'),
      },
      hits: this.hits,
      misses: this.misses,
      ...(total > 0 ? { hitRate: this.hits / total } : {}),
      ...(bounds.oldest ? { oldestAt: new Date(bounds.oldest).toISOString() } : {}),
      ...(bounds.newest ? { newestAt: new Date(bounds.newest).toISOString() } : {}),
    };
  }

  async clear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<number> {
    if (opts.scope === 'expired') {
      const now = Date.now();
      const expired = this.conn.prepare('SELECT query_id FROM queries WHERE expires_at < ?').all(now).map((r) => String(r.query_id));
      let n = 0;
      for (const id of expired) {
        n += Number((this.conn.prepare('DELETE FROM jobs WHERE query_id = ?').run(id) as { changes?: number }).changes ?? 0);
        n += Number((this.conn.prepare('DELETE FROM queries WHERE query_id = ?').run(id) as { changes?: number }).changes ?? 0);
      }
      return n;
    }
    if (opts.prefix) {
      const like = `${opts.prefix}%`;
      let n = 0;
      for (const [table, col] of [
        ['queries', 'query_id'],
        ['jobs', 'query_id'],
        ['job_details', 'job_id'],
        ['companies', 'company_id'],
        ['company_details', 'company_id'],
        ['company_jobs', 'company_id'],
      ] as const) {
        const res = this.conn.prepare(`DELETE FROM ${table} WHERE ${col} LIKE ?`).run(like) as { changes?: number };
        n += Number(res.changes ?? 0);
      }
      return n;
    }
    const tables = ['queries', 'jobs', 'job_details', 'companies', 'company_details', 'company_jobs', 'meta'];
    let n = 0;
    for (const t of tables) n += Number((this.conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
    this.conn.exec('DELETE FROM queries; DELETE FROM jobs; DELETE FROM job_details; DELETE FROM companies; DELETE FROM company_details; DELETE FROM company_jobs; DELETE FROM meta;');
    return n;
  }
}
