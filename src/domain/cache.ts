/**
 * 缓存领域模型
 */
import { z } from 'zod';

export const CacheStatsSchema = z
  .object({
    dbPath: z.string(),
    driver: z.enum(['sqlite', 'memory']),
    sizeBytes: z.number().int().nonnegative().optional(),
    entries: z.object({
      queries: z.number().int().nonnegative(),
      jobs: z.number().int().nonnegative(),
      jobDetails: z.number().int().nonnegative(),
      companies: z.number().int().nonnegative(),
      companyDetails: z.number().int().nonnegative(),
      companyJobs: z.number().int().nonnegative(),
    }),
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    hitRate: z.number().min(0).max(1).optional(),
    oldestAt: z.string().optional(),
    newestAt: z.string().optional(),
  })
  .meta({ id: 'CacheStats' });

export type CacheStats = z.infer<typeof CacheStatsSchema>;

export const CacheClearQuerySchema = z
  .object({
    scope: z.enum(['all', 'expired']).default('all'),
    prefix: z.string().optional(),
  })
  .meta({ id: 'CacheClearQuery' });

export type CacheClearResult = z.infer<typeof CacheClearResultSchema>;
export type CacheClearQuery = z.infer<typeof CacheClearQuerySchema>;

export const CacheClearResultSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
    dbPath: z.string(),
  })
  .meta({ id: 'CacheClearResult' });
