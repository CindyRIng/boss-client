/**
 * 岗位领域模型
 */
import { z } from 'zod';
import { CityCodeSchema, CompanyIdSchema, IsoDateTimeSchema, JobIdSchema, SecurityIdSchema } from './common.js';

export const RecruiterSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    online: z.boolean().optional(),
    avatar: z.string().optional(),
  })
  .meta({ id: 'Recruiter' });

export const JobCompanySchema = z
  .object({
    companyId: CompanyIdSchema.optional(),
    name: z.string().optional(),
    industry: z.string().optional(),
    scale: z.string().optional(),
    stage: z.string().optional(),
    logo: z.string().optional(),
  })
  .meta({ id: 'JobCompany' });

export const JobSummarySchema = z
  .object({
    jobId: JobIdSchema,
    securityId: SecurityIdSchema.optional().describe('短时效令牌；日志中截断。jobs.detail 优先用 jobId'),
    lid: z.string().optional(),
    title: z.string(),
    salaryText: z.string().default(''),
    salaryMin: z.number().nonnegative().optional(),
    salaryMax: z.number().nonnegative().optional(),
    experience: z.string().default(''),
    degree: z.string().default(''),
    cityCode: CityCodeSchema.optional(),
    cityName: z.string().optional(),
    district: z.string().optional(),
    businessDistrict: z.string().optional(),
    companyId: CompanyIdSchema,
    companyName: z.string(),
    companyIndustry: z.string().optional(),
    companyScale: z.string().optional(),
    companyStage: z.string().optional(),
    bossName: z.string().optional(),
    bossTitle: z.string().optional(),
    bossOnline: z.boolean().optional(),
    skills: z.array(z.string()).default([]),
    welfare: z.array(z.string()).default([]),
    jobUrl: z.string().url(),
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema,
  })
  .meta({ id: 'JobSummary' });

export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobBriefSchema = z
  .object({
    jobId: JobIdSchema,
    title: z.string(),
    salaryText: z.string().default(''),
    cityName: z.string().optional(),
    bossName: z.string().optional(),
    bossTitle: z.string().optional(),
  })
  .meta({ id: 'JobBrief' });

export const JobDetailSchema = z
  .object({
    jobId: JobIdSchema,
    securityId: SecurityIdSchema.optional(),
    title: z.string(),
    salaryText: z.string().default(''),
    experience: z.string().default(''),
    degree: z.string().default(''),
    cityName: z.string().optional(),
    district: z.string().optional(),
    address: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    description: z.string().default(''),
    skills: z.array(z.string()).default([]),
    jobStatusDesc: z.string().optional(),
    recruiter: RecruiterSchema.default({}),
    company: JobCompanySchema.default({}),
    jobUrl: z.string().url(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'JobDetail' });

export type JobDetail = z.infer<typeof JobDetailSchema>;
