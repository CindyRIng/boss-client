/**
 * 操作分发：REST/CLI/MCP → BossService
 */
import type { BossService } from '../service.js';
import type { PaginationMeta } from '../schemas/envelope.js';
import type { LoginCaptchaRequest, LoginStartRequest } from '../domain/login.js';
import type { SearchJobsRequest } from '../domain/search.js';

export interface InvocationInput {
  pathParams?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface InvocationResult {
  data: unknown;
  pagination?: PaginationMeta;
  cached?: boolean;
}

function pageOf(result: { pagination?: PaginationMeta }): PaginationMeta | undefined {
  return result.pagination;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

export async function invoke(service: BossService, operationId: string, input: InvocationInput): Promise<InvocationResult> {
  const { pathParams = {}, query = {}, body = {} } = input;
  switch (operationId) {
    case 'health.get':
      return { data: await service.health() };
    case 'status.get':
      return { data: await service.status() };
    case 'session.login.start':
      return { data: await service.loginStart(body as LoginStartRequest) };
    case 'session.login.get':
      return { data: await service.loginGet(pathParams.loginId ?? '') };
    case 'session.login.captcha': {
      const b = body as { kind?: string; points?: Array<{ x: number; y: number }>; offsetRatio?: number; offsetPx?: number };
      const answer: LoginCaptchaRequest =
        b.kind === 'slider'
          ? { kind: 'slider', ...(b.offsetRatio !== undefined ? { offsetRatio: b.offsetRatio } : {}), ...(b.offsetPx !== undefined ? { offsetPx: b.offsetPx } : {}) }
          : { kind: 'click', points: b.points ?? [] };
      return { data: await service.loginCaptcha(pathParams.loginId ?? '', answer) };
    }
    case 'session.login.sms': {
      const b = body as { code?: string };
      return { data: await service.loginSms(pathParams.loginId ?? '', b.code ?? '') };
    }
    case 'session.login.cancel':
      return { data: await service.loginCancel(pathParams.loginId ?? '') };
    case 'search.jobs': {
      const r = await service.searchJobs(body as SearchJobsRequest);
      return { data: r, pagination: r.pagination, cached: false };
    }
    case 'jobs.list': {
      const r = await service.listJobs({
        queryId: String(query.queryId ?? ''),
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 15),
        refresh: asBool(query.refresh),
      });
      return { data: r, pagination: r.pagination, cached: false };
    }
    case 'jobs.detail':
      return {
        data: await service.jobDetail({
          jobId: pathParams.jobId ?? '',
          securityId: typeof query.securityId === 'string' ? query.securityId : undefined,
          lid: typeof query.lid === 'string' ? query.lid : undefined,
          refresh: asBool(query.refresh),
        }),
      };
    case 'companies.list': {
      const r = await service.listCompanies({
        queryId: String(query.queryId ?? ''),
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 20),
        fetchPages: Number(query.fetchPages ?? 0),
        refresh: asBool(query.refresh),
      });
      return { data: r, pagination: r.pagination, cached: false };
    }
    case 'companies.detail':
      return { data: await service.companyDetail({ companyId: pathParams.companyId ?? '', refresh: asBool(query.refresh) }) };
    case 'companies.jobs':
      return { data: await service.companyJobs({ companyId: pathParams.companyId ?? '', refresh: asBool(query.refresh) }) };
    case 'cities.list':
      return { data: await service.cities(asBool(query.refresh)) };
    case 'cache.stats':
      return { data: await service.cacheStats() };
    case 'cache.clear':
      return {
        data: await service.cacheClear({
          scope: query.scope === 'expired' ? 'expired' : 'all',
          ...(typeof query.prefix === 'string' && query.prefix ? { prefix: query.prefix } : {}),
        }),
      };
    default:
      throw new Error(`unknown operation: ${operationId}`);
  }
}

export { pageOf };
