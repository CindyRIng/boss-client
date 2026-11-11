/**
 * BOSS 上游响应 zod schema（宽松 passthrough，字段变更有据可查）
 */
import { z } from 'zod';
import { BossError } from '../../errors/catalog.js';

export const RawBossEnvelopeSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    msg: z.string().optional(),
    zpData: z.unknown().optional(),
  })
  .passthrough();

export type RawBossEnvelope = z.infer<typeof RawBossEnvelopeSchema>;

export const RawJobRowSchema = z
  .object({
    securityId: z.string().optional(),
    encryptJobId: z.string(),
    lid: z.string().optional(),
    jobName: z.string().default(''),
    salaryDesc: z.string().default(''),
    jobExperience: z.string().optional(),
    jobDegree: z.string().optional(),
    jobLabels: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    city: z.union([z.number(), z.string()]).optional(),
    cityName: z.string().optional(),
    areaDistrict: z.string().optional(),
    businessDistrict: z.string().optional(),
    encryptBrandId: z.string(),
    brandName: z.string().default(''),
    brandIndustry: z.string().optional(),
    brandScaleName: z.string().optional(),
    brandStageName: z.string().optional(),
    brandLogo: z.string().optional(),
    bossName: z.string().optional(),
    bossTitle: z.string().optional(),
    bossOnline: z.boolean().optional(),
    bossAvatar: z.string().optional(),
    welfareList: z.array(z.string()).optional(),
    jobValidStatus: z.number().optional(),
    jobType: z.number().optional(),
  })
  .passthrough();

export type RawJobRow = z.infer<typeof RawJobRowSchema>;

export const RawJobListDataSchema = z
  .object({
    resCount: z.number().optional(),
    totalCount: z.number().optional(),
    hasMore: z.boolean().optional(),
    lid: z.string().optional(),
    jobList: z.array(RawJobRowSchema).default([]),
  })
  .passthrough();

export const RawJobInfoSchema = z
  .object({
    encryptId: z.string().optional(),
    jobName: z.string().default(''),
    salaryDesc: z.string().default(''),
    experienceName: z.string().optional(),
    degreeName: z.string().optional(),
    locationName: z.string().optional(),
    address: z.string().optional(),
    longitude: z.number().optional(),
    latitude: z.number().optional(),
    postDescription: z.string().optional(),
    showSkills: z.array(z.string()).optional(),
    jobStatusDesc: z.string().optional(),
  })
  .passthrough();

export const RawBossInfoSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    online: z.boolean().nullable().optional(),
    bossOnline: z.boolean().nullable().optional(),
    large: z.string().optional(),
  })
  .passthrough();

export const RawBrandComInfoSchema = z
  .object({
    encryptBrandId: z.string().optional(),
    brandName: z.string().optional(),
    logo: z.string().optional(),
    stageName: z.string().optional(),
    scaleName: z.string().optional(),
    industryName: z.string().optional(),
    introduce: z.string().optional(),
  })
  .passthrough();

export type RawJobListData = z.infer<typeof RawJobListDataSchema>;

export const RawJobDetailDataSchema = z
  .object({
    jobInfo: RawJobInfoSchema,
    bossInfo: RawBossInfoSchema.optional(),
    brandComInfo: RawBrandComInfoSchema.optional(),
  })
  .passthrough();

export type RawJobDetailData = z.infer<typeof RawJobDetailDataSchema>;

export const RawUserInfoDataSchema = z
  .object({
    userId: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
    showName: z.string().optional(),
    token: z.string().optional(),
    isHunter: z.boolean().optional(),
    studentFlag: z.boolean().optional(),
    complete: z.boolean().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .passthrough();

export const RawAccountStatusDataSchema = z
  .object({
    bindWeiXin: z.boolean().optional(),
    deviceSecurity: z.boolean().optional(),
  })
  .passthrough();

export function assertBossEnvelope(raw: unknown, label: string): RawBossEnvelope {
  const parsed = RawBossEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BossError('UPSTREAM_CHANGED', `BOSS ${label} 响应不是预期 envelope`, { details: { issues: parsed.error.issues } });
  }
  const code = Number(parsed.data.code);
  if (code === 37) {
    throw new BossError('UPSTREAM_BLOCKED', `BOSS ${label} 返回 code37 环境异常`, {
      details: { code: 37, message: parsed.data.message ?? parsed.data.msg ?? '' },
    });
  }
  if (code !== 0) {
    throw new BossError('UPSTREAM_UNAVAILABLE', `BOSS ${label} 返回 code=${parsed.data.code}`, {
      details: { code: parsed.data.code, message: parsed.data.message ?? parsed.data.msg ?? '' },
    });
  }
  return parsed.data;
}

export function parseZpData<T extends z.ZodTypeAny>(data: RawBossEnvelope, schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(data.zpData);
  if (!parsed.success) {
    throw new BossError('UPSTREAM_CHANGED', `BOSS ${label} zpData 不符合预期`, { details: { issues: parsed.error.issues } });
  }
  return parsed.data;
}
