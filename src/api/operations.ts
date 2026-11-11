/**
 * 操作注册表（单一事实源：REST 路由 / CLI / MCP / 文档生成）
 */
import { z } from 'zod';
import { HealthResponseSchema, StatusSchema } from '../domain/status.js';
import {
  LoginCancelResponseSchema,
  LoginCaptchaRequestSchema,
  LoginSessionSchema,
  LoginSmsRequestSchema,
  LoginStartRequestSchema,
} from '../domain/login.js';
import {
  CompaniesListResponseSchema,
  JobsListQuerySchema,
  JobsListResponseSchema,
  JobDetailQuerySchema,
  SearchJobsRequestSchema,
  SearchJobsResponseSchema,
} from '../domain/search.js';
import { JobDetailSchema } from '../domain/job.js';
import {
  CompaniesListQuerySchema,
  CompanyDetailQuerySchema,
  CompanyDetailSchema,
  CompanyJobsQuerySchema,
  CompanyJobsResponseSchema,
} from '../domain/company.js';
import { CacheClearQuerySchema, CacheClearResultSchema, CacheStatsSchema } from '../domain/cache.js';
import { BooleanQuerySchema, CityCodeSchema, CompanyIdSchema, JobIdSchema, LoginIdSchema, QueryIdSchema } from '../domain/common.js';

export interface OperationDef {
  id: string;
  summary: string;
  auth: 'none' | 'bearer';
  rest: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    pathParams?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  cli: { command: string; description: string; example?: string };
  mcp: { name: string; description: string };
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
}

const Empty = z.object({}).strict();

export const LoginCaptchaInputSchema = z
  .object({
    loginId: LoginIdSchema,
    kind: z.enum(['click', 'slider']),
    points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).optional(),
    offsetRatio: z.number().min(0).max(1).optional(),
    offsetPx: z.number().min(0).optional(),
  })
  .meta({ id: 'LoginCaptchaInput' });

export const CitiesQuerySchema = z
  .object({ refresh: BooleanQuerySchema.optional() })
  .meta({ id: 'CitiesQuery' });

export const CitiesResponseSchema = z
  .object({
    cities: z.array(
      z.object({
        cityCode: CityCodeSchema,
        cityName: z.string(),
        province: z.string().optional(),
        isDefault: z.boolean(),
      }),
    ),
    updatedAt: z.string(),
  })
  .meta({ id: 'CitiesResponse' });

export const OPERATIONS: OperationDef[] = [
  {
    id: 'health.get',
    summary: '健康检查',
    auth: 'none',
    rest: { method: 'GET', path: '/v1/health' },
    cli: { command: 'health', description: '健康检查', example: 'boss health' },
    mcp: { name: 'boss_health', description: '健康检查' },
    input: Empty,
    output: HealthResponseSchema,
  },
  {
    id: 'status.get',
    summary: '登录态 / 会话 / 风控 / 缓存状态',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/status' },
    cli: { command: 'status', description: '查看登录态、会话剩余时间、风控冷却、缓存', example: 'boss status' },
    mcp: { name: 'boss_status', description: '查看登录态、会话剩余时间、风控冷却、缓存' },
    input: Empty,
    output: StatusSchema,
  },
  {
    id: 'session.login.start',
    summary: '开始登录（短信/二维码）',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/session/login', body: LoginStartRequestSchema },
    cli: { command: 'login start', description: '开始登录（默认短信；--qr 扫码）', example: 'boss login start --sms' },
    mcp: { name: 'boss_login_start', description: '开始登录：mode=sms|qr' },
    input: LoginStartRequestSchema,
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.get',
    summary: '查询登录流程状态',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/session/login/{loginId}', pathParams: z.object({ loginId: LoginIdSchema }) },
    cli: { command: 'login status', description: '查询 loginId 状态', example: 'boss login status login_xxx' },
    mcp: { name: 'boss_login_status', description: '查询登录流程状态' },
    input: z.object({ loginId: LoginIdSchema }),
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.captcha',
    summary: '提交极验答案（点击坐标/滑块偏移）',
    auth: 'bearer',
    rest: {
      method: 'POST',
      path: '/v1/session/login/{loginId}/captcha',
      pathParams: z.object({ loginId: LoginIdSchema }),
      body: LoginCaptchaRequestSchema,
    },
    cli: { command: 'login captcha', description: '提交验证码答案', example: 'boss login captcha login_xxx --points 0.68,0.62 0.17,0.54' },
    mcp: { name: 'boss_login_captcha_solve', description: '提交极验点击坐标或滑块偏移' },
    input: LoginCaptchaInputSchema,
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.sms',
    summary: '提交短信验证码',
    auth: 'bearer',
    rest: {
      method: 'POST',
      path: '/v1/session/login/{loginId}/sms',
      pathParams: z.object({ loginId: LoginIdSchema }),
      body: LoginSmsRequestSchema,
    },
    cli: { command: 'login sms', description: '提交短信验证码', example: 'boss login sms login_xxx --code 123456' },
    mcp: { name: 'boss_login_sms_verify', description: '提交短信验证码' },
    input: z.object({ loginId: LoginIdSchema, code: LoginSmsRequestSchema.shape.code }),
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.cancel',
    summary: '取消登录流程',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/session/login/{loginId}', pathParams: z.object({ loginId: LoginIdSchema }) },
    cli: { command: 'login cancel', description: '取消登录流程', example: 'boss login cancel login_xxx' },
    mcp: { name: 'boss_login_cancel', description: '取消登录流程' },
    input: z.object({ loginId: LoginIdSchema }),
    output: LoginCancelResponseSchema,
  },
  {
    id: 'search.jobs',
    summary: '按关键词 + 城市搜索岗位',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/search/jobs', body: SearchJobsRequestSchema },
    cli: { command: 'search jobs', description: '岗位搜索', example: 'boss search jobs --keyword 外贸 --city 101090100' },
    mcp: { name: 'boss_search_jobs', description: '按关键词 + 城市搜索岗位' },
    input: SearchJobsRequestSchema,
    output: SearchJobsResponseSchema,
  },
  {
    id: 'jobs.list',
    summary: '按 queryId 翻页',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/jobs', query: JobsListQuerySchema },
    cli: { command: 'jobs list', description: '按 queryId 翻页', example: 'boss jobs list --query-id q_20261111_ab12cd --page 2' },
    mcp: { name: 'boss_list_jobs', description: '按 queryId 翻页' },
    input: JobsListQuerySchema,
    output: JobsListResponseSchema,
  },
  {
    id: 'jobs.detail',
    summary: '岗位详情',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/jobs/{jobId}',
      pathParams: z.object({ jobId: JobIdSchema }),
      query: JobDetailQuerySchema,
    },
    cli: { command: 'jobs detail', description: '岗位详情', example: 'boss jobs detail --job-id 9b48...' },
    mcp: { name: 'boss_job_detail', description: '岗位详情' },
    input: z.object({
      jobId: JobIdSchema,
      securityId: z.string().optional(),
      lid: z.string().optional(),
      refresh: z.boolean().default(false),
    }),
    output: JobDetailSchema,
  },
  {
    id: 'companies.list',
    summary: '岗位结果按公司去重',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/companies', query: CompaniesListQuerySchema },
    cli: { command: 'companies list', description: '去重公司列表', example: 'boss companies list --query-id q_20261111_ab12cd' },
    mcp: { name: 'boss_list_companies', description: '岗位结果按公司去重' },
    input: CompaniesListQuerySchema,
    output: CompaniesListResponseSchema,
  },
  {
    id: 'companies.detail',
    summary: '公司详情（含工商信息）',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/companies/{companyId}',
      pathParams: z.object({ companyId: CompanyIdSchema }),
      query: CompanyDetailQuerySchema,
    },
    cli: { command: 'companies detail', description: '公司详情（含工商信息）', example: 'boss companies detail --id d6c1...' },
    mcp: { name: 'boss_company_detail', description: '公司详情（含工商信息）' },
    input: z.object({ companyId: CompanyIdSchema, refresh: z.boolean().default(false) }),
    output: CompanyDetailSchema,
  },
  {
    id: 'companies.jobs',
    summary: '公司全部在招职位',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/companies/{companyId}/jobs',
      pathParams: z.object({ companyId: CompanyIdSchema }),
      query: CompanyJobsQuerySchema,
    },
    cli: { command: 'companies jobs', description: '公司全部在招职位', example: 'boss companies jobs --id d6c1...' },
    mcp: { name: 'boss_company_jobs', description: '公司全部在招职位' },
    input: z.object({ companyId: CompanyIdSchema, refresh: z.boolean().default(false) }),
    output: CompanyJobsResponseSchema,
  },
  {
    id: 'cities.list',
    summary: '城市注册表',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/cities', query: CitiesQuerySchema },
    cli: { command: 'cities list', description: '城市注册表', example: 'boss cities list --refresh' },
    mcp: { name: 'boss_cities', description: '城市注册表' },
    input: CitiesQuerySchema,
    output: CitiesResponseSchema,
  },
  {
    id: 'cache.stats',
    summary: '缓存统计',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/cache/stats' },
    cli: { command: 'cache stats', description: '缓存统计', example: 'boss cache stats' },
    mcp: { name: 'boss_cache_stats', description: '缓存统计' },
    input: Empty,
    output: CacheStatsSchema,
  },
  {
    id: 'cache.clear',
    summary: '清缓存',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/cache', query: CacheClearQuerySchema },
    cli: { command: 'cache clear', description: '清缓存', example: 'boss cache clear --all' },
    mcp: { name: 'boss_cache_clear', description: '清缓存：scope=all|expired' },
    input: CacheClearQuerySchema,
    output: CacheClearResultSchema,
  },
];

export function getOperation(id: string): OperationDef {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`unknown operation: ${id}`);
  return op;
}

export function mcpTools(): Array<{ name: string; description: string; input: z.ZodTypeAny; operationId: string }> {
  return OPERATIONS.map((o) => ({ name: o.mcp.name, description: o.mcp.description, input: o.input, operationId: o.id }));
}

export function cliCommands(): Array<{ command: string; description: string; example?: string; operationId: string }> {
  return OPERATIONS.map((o) => ({ command: `boss ${o.cli.command}`, description: o.cli.description, ...(o.cli.example ? { example: o.cli.example } : {}), operationId: o.id }));
}

export { QueryIdSchema };
