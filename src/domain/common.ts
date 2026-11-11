/**
 * 通用基础类型与 zod schema（单一事实源）
 */
import { z } from 'zod';

export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/, 'must be ISO-8601 with timezone')
  .meta({ id: 'IsoDateTime', description: 'ISO-8601 日期时间（含时区）' });

export const NonEmptyStringSchema = z.string().min(1);
export const UrlSchema = z.string().url();

export const PageSchema = z.coerce.number().int().min(1).default(1).meta({ description: '页码，从 1 开始' });
export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(15)
  .meta({ description: '每页条数，1-100' });
export const MaxPagesSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(5)
  .default(1)
  .meta({ description: '本次抓取页数，1-5' });
export const FetchPagesSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .default(0)
  .meta({ description: 'companies.list 额外抓取页数，0-5' });

/** REST query 里的 boolean：接受 true/false 字符串或布尔 */
export const BooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')
  .default(false);

export const CityCodeSchema = z
  .string()
  .regex(/^\d{6,12}$/, 'cityCode must be a numeric string')
  .meta({ id: 'CityCode', description: 'BOSS 数字城市码，如 101090100（石家庄）' });

export const JobIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,80}$/, 'invalid jobId')
  .meta({ id: 'JobId', description: 'encryptJobId，用于 /job_detail/<id>.html' });

export const SecurityIdSchema = z
  .string()
  .min(16)
  .max(4096)
  .meta({ id: 'SecurityId', description: '岗位详情 API 的 securityId（短时效）' });

export const CompanyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_~.-]{4,160}$/, 'invalid companyId')
  .meta({ id: 'CompanyId', description: 'encryptBrandId，用于 /gongsi/<id>.html' });

export const QueryIdSchema = z
  .string()
  .regex(/^q_\d{8}_[a-z0-9]{4,16}$/, 'invalid queryId')
  .meta({ id: 'QueryId', description: '搜索查询 ID' });

export const LoginIdSchema = z
  .string()
  .regex(/^login_[A-Za-z0-9_-]{8,64}$/, 'invalid loginId')
  .meta({ id: 'LoginId', description: '登录流程 ID' });

export const RequestIdSchema = z.string().min(8).meta({ description: '请求 ID，用于日志追踪' });

export const CacheTtlSchema = z.number().int().nonnegative();

export function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const p = phone.replace(/\s+/g, '');
  if (p.length < 7) return '***';
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

export function maskName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name.length <= 1) return '*';
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(2, name.length - 1))}`;
}
