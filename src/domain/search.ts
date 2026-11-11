/**
 * 搜索/分页领域模型
 */
import { z } from 'zod';
import { CityCodeSchema, IsoDateTimeSchema, QueryIdSchema } from './common.js';
import { CompanySummarySchema } from './company.js';
import { JobDetailSchema, JobSummarySchema } from './job.js';

export const SearchQuerySchema = z
  .object({
    queryId: QueryIdSchema,
    keyword: z.string(),
    cityCode: CityCodeSchema,
    cityName: z.string().optional(),
    pageSize: z.number().int().min(1).max(100),
    pagesFetched: z.number().int().nonnegative(),
    resCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'SearchQuery' });

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchJobsRequestSchema = z
  .object({
    keyword: z.string().min(1),
    cityCode: CityCodeSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(15),
    pages: z.number().int().min(1).max(5).default(1),
    refresh: z.boolean().default(false),
  })
  .meta({ id: 'SearchJobsRequest' });

export type SearchJobsRequest = z.infer<typeof SearchJobsRequestSchema>;

export const SearchJobsResponseSchema = z
  .object({
    query: SearchQuerySchema,
    jobs: z.array(JobSummarySchema),
    companies: z.array(CompanySummarySchema),
    pagination: z.object({
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      total: z.number().int().nonnegative(),
      hasMore: z.boolean(),
      pagesFetched: z.number().int().nonnegative(),
      pagesAvailable: z.number().int().nonnegative(),
    }),
  })
  .meta({ id: 'SearchJobsResponse' });

export const JobsListQuerySchema = z
  .object({
    queryId: z.string(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    refresh: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .meta({ id: 'JobsListQuery' });

export const JobsListResponseSchema = z
  .object({
    query: SearchQuerySchema,
    jobs: z.array(JobSummarySchema),
    pagination: SearchJobsResponseSchema.shape.pagination,
  })
  .meta({ id: 'JobsListResponse' });

export const JobDetailQuerySchema = z
  .object({
    securityId: z.string().optional(),
    lid: z.string().optional(),
    refresh: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .meta({ id: 'JobDetailQuery' });

export const JobDetailResponseSchema = JobDetailSchema;

export const CompaniesListResponseSchema = z
  .object({
    query: SearchQuerySchema,
    companies: z.array(CompanySummarySchema),
    pagination: SearchJobsResponseSchema.shape.pagination,
  })
  .meta({ id: 'CompaniesListResponse' });
