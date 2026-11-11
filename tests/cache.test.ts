import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryCacheStore } from '../src/cache/memory.js';
import { SqliteCacheStore } from '../src/cache/sqlite.js';
import type { JobSummary } from '../src/domain/job.js';
import type { SearchQueryRecord } from '../src/cache/types.js';

function job(id: string, companyId = 'company~1'): JobSummary {
  const ts = new Date().toISOString();
  return {
    jobId: id,
    title: '外贸业务员',
    companyId,
    companyName: '测试公司',
    salaryText: '4-8K',
    experience: '1-3年',
    degree: '大专',
    skills: [],
    welfare: [],
    jobUrl: `https://www.zhipin.com/job_detail/${id}.html`,
    firstSeenAt: ts,
    lastSeenAt: ts,
  };
}

function query(id = 'q_20261111_abcd12'): SearchQueryRecord {
  const now = Date.now();
  return {
    queryId: id,
    keyword: '外贸',
    cityCode: '101090100',
    cityName: '石家庄',
    pageSize: 15,
    pagesFetched: 1,
    resCount: 450,
    totalCount: 300,
    hasMore: true,
    fetchedAt: now,
    expiresAt: now + 86400_000,
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function runStore(store: MemoryCacheStore | SqliteCacheStore) {
  await store.init();
  const q = query();
  store.putQuery(q, 'cache-key-1');
  expect(store.getQuery(q.queryId)?.keyword).toBe('外贸');
  expect(store.getQueryByCacheKey('cache-key-1')?.queryId).toBe(q.queryId);
  store.putJobs(q.queryId, 1, [job('job1'), job('job2')]);
  expect(store.getJobsByQuery(q.queryId)).toHaveLength(2);
  expect(store.getJobPage(q.queryId, 1, 7200)?.value).toHaveLength(2);
  store.updateQueryProgress(q.queryId, { pagesFetched: 2 });
  expect(store.getQuery(q.queryId)?.pagesFetched).toBe(2);
  const stats = await store.stats();
  expect(stats.entries.queries).toBe(1);
  expect(stats.entries.jobs).toBe(2);
  const cleared = await store.clear({ scope: 'all' });
  expect(cleared).toBeGreaterThan(0);
  expect(store.getQuery(q.queryId)).toBeNull();
  await store.close();
}

describe('cache', () => {
  it('memory store works', async () => {
    await runStore(new MemoryCacheStore());
  });

  it('sqlite store works', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-cache-'));
    tempDirs.push(dir);
    await runStore(new SqliteCacheStore(path.join(dir, 'cache.db')));
  });
});
