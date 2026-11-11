/**
 * 公司领域模型
 */
import { z } from 'zod';
import { CompanyIdSchema, IsoDateTimeSchema, JobIdSchema, SecurityIdSchema } from './common.js';
import { JobBriefSchema } from './job.js';

export const BusinessInfoSchema = z
  .object({
    companyName: z.string().optional(),
    legalRepresentative: z.string().optional(),
    foundedAt: z.string().optional(),
    companyType: z.string().optional(),
    businessStatus: z.string().optional(),
    registeredCapital: z.string().optional(),
    registeredAddress: z.string().optional(),
    businessTerm: z.string().optional(),
    region: z.string().optional(),
    uscc: z.string().optional(),
    approvalDate: z.string().optional(),
    registrationAuthority: z.string().optional(),
    formerNames: z.string().optional(),
    businessScope: z.string().optional(),
    usccSource: z.literal('boss_company_page_text').default('boss_company_page_text'),
    textDerived: z.literal(true).default(true),
  })
  .meta({ id: 'BusinessInfo' });

export type BusinessInfo = z.infer<typeof BusinessInfoSchema>;

export const CompanySummarySchema = z
  .object({
    companyId: CompanyIdSchema,
    name: z.string(),
    industry: z.string().optional(),
    scale: z.string().optional(),
    stage: z.string().optional(),
    cityName: z.string().optional(),
    address: z.string().optional(),
    jobCount: z.number().int().nonnegative().default(0),
    matchedJobs: z.array(JobBriefSchema).default([]),
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema,
  })
  .meta({ id: 'CompanySummary' });

export type CompanySummary = z.infer<typeof CompanySummarySchema>;

export const CompanyJobSchema = z
  .object({
    jobId: JobIdSchema,
    securityId: SecurityIdSchema.optional(),
    title: z.string(),
    salaryText: z.string().default(''),
    experience: z.string().optional(),
    degree: z.string().optional(),
    cityName: z.string().optional(),
    district: z.string().optional(),
    businessDistrict: z.string().optional(),
    recruiterName: z.string().optional(),
    recruiterTitle: z.string().optional(),
    jobUrl: z.string().url(),
  })
  .meta({ id: 'CompanyJob' });

export type CompanyJob = z.infer<typeof CompanyJobSchema>;

export const CompanyDetailSchema = z
  .object({
    companyId: CompanyIdSchema,
    name: z.string(),
    fullName: z.string().optional(),
    logo: z.string().optional(),
    industry: z.string().optional(),
    scale: z.string().optional(),
    stage: z.string().optional(),
    cityName: z.string().optional(),
    address: z.string().optional(),
    intro: z.string().optional(),
    tags: z.array(z.string()).default([]),
    benefits: z.array(z.string()).default([]),
    jobCount: z.number().int().nonnegative().default(0),
    bossCount: z.number().int().nonnegative().default(0),
    hotJobs: z.array(CompanyJobSchema).default([]),
    recruiters: z.array(z.object({ name: z.string().optional(), title: z.string().optional(), online: z.boolean().optional() })).default([]),
    business: BusinessInfoSchema.default({ usccSource: 'boss_company_page_text', textDerived: true }),
    url: z.string().url(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'CompanyDetail' });

export type CompanyDetail = z.infer<typeof CompanyDetailSchema>;

export const CompaniesListQuerySchema = z
  .object({
    queryId: z.string(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    fetchPages: z.coerce.number().int().min(0).max(5).default(0),
    refresh: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .meta({ id: 'CompaniesListQuery' });

export const CompanyDetailQuerySchema = z
  .object({
    refresh: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .meta({ id: 'CompanyDetailQuery' });

export const CompanyJobsQuerySchema = z
  .object({
    refresh: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .meta({ id: 'CompanyJobsQuery' });

export const CompanyJobsResponseSchema = z
  .object({
    companyId: CompanyIdSchema,
    jobCount: z.number().int().nonnegative(),
    jobs: z.array(CompanyJobSchema),
    truncated: z.boolean().default(false),
  })
  .meta({ id: 'CompanyJobsResponse' });
