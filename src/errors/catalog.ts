/**
 * 统一错误码目录（REST / CLI / MCP 共用）
 */
import { z } from 'zod';

export interface ErrorCodeMeta {
  readonly http: number;
  readonly retryable: boolean;
  readonly title: string;
  readonly description: string;
}

export const ERROR_CATALOG = {
  BAD_REQUEST: { http: 400, retryable: false, title: '参数错误', description: '请求参数不合法（格式/范围/必填项缺失）' },
  UNAUTHORIZED: { http: 401, retryable: false, title: '未授权', description: 'REST/MCP 鉴权失败（Bearer token 缺失或错误）' },
  AUTH_REQUIRED: { http: 401, retryable: true, title: '需要登录', description: 'BOSS 登录态缺失或失效，需要登录' },
  SESSION_EXPIRED: { http: 401, retryable: false, title: '会话失效', description: 'BOSS 会话已失效，需要人工重新登录' },
  LOGIN_REQUIRED: { http: 401, retryable: true, title: '需要登录', description: '当前操作需要先登录' },
  LOGIN_IN_PROGRESS: { http: 409, retryable: true, title: '登录进行中', description: '已有登录流程进行中，请等待/取消后再试' },
  LOGIN_EXPIRED: { http: 410, retryable: false, title: '登录过期', description: 'loginId 已过期或已取消' },
  LOGIN_CANCELLED: { http: 409, retryable: false, title: '登录已取消', description: '登录流程已被取消' },
  CAPTCHA_REQUIRED: { http: 409, retryable: true, title: '需要验证码', description: '需要完成极验；details 内含 captcha 信息' },
  CAPTCHA_INVALID: { http: 409, retryable: true, title: '验证码错误', description: '验证码答案错误；details 内含新 captcha 信息' },
  SMS_CODE_REQUIRED: { http: 409, retryable: true, title: '需要短信码', description: '需要提交短信验证码' },
  SMS_CODE_INVALID: { http: 409, retryable: true, title: '短信码错误', description: '短信验证码错误或已失效' },
  SMS_RATE_LIMITED: { http: 429, retryable: true, title: '短信频控', description: '短信发送过于频繁，请稍后再试' },
  FORBIDDEN: { http: 403, retryable: false, title: '无权限', description: '账号无权限或触发风控' },
  NOT_FOUND: { http: 404, retryable: false, title: '不存在', description: '岗位/公司/查询会话/资源不存在' },
  METHOD_NOT_ALLOWED: { http: 405, retryable: false, title: '方法不允许', description: 'HTTP 方法不匹配' },
  QUERY_EXPIRED: { http: 410, retryable: false, title: '查询过期', description: 'queryId 已过期，请重新搜索' },
  CONFLICT: { http: 409, retryable: false, title: '状态冲突', description: '当前状态不允许该操作' },
  ALREADY_RUNNING: { http: 409, retryable: false, title: '已在运行', description: '同一 profile 已有 boss-client 在运行（单实例约束）' },
  HEADFUL_REQUIRED: { http: 409, retryable: false, title: '需要 headful 浏览器', description: '短信登录/极验需要可用的 DISPLAY；二维码扫码可在 headless 下完成' },
  VALIDATION_FAILED: { http: 422, retryable: false, title: '校验失败', description: '请求参数 JSON Schema 校验未通过，details 内给出字段级问题' },
  RATE_LIMITED: { http: 429, retryable: true, title: '限频', description: '触发本地限频或上游限流，按 retryAfterMs 退避' },
  TIMEOUT: { http: 504, retryable: true, title: '上游超时', description: 'BOSS 页面/接口响应超时' },
  UPSTREAM_BLOCKED: { http: 502, retryable: false, title: '上游风控拦截', description: 'BOSS 返回 code37 / 环境异常，进入冷却后重试' },
  UPSTREAM_CHANGED: { http: 502, retryable: false, title: '上游改版', description: 'BOSS 页面结构/接口字段变化导致解析失败' },
  UPSTREAM_UNAVAILABLE: { http: 503, retryable: true, title: '上游不可用', description: '网络异常/BOSS 服务不可达' },
  SERVICE_UNAVAILABLE: { http: 503, retryable: true, title: '常驻服务不可达', description: '本地 boss-client REST 服务未启动或不可达' },
  NOT_IMPLEMENTED: { http: 501, retryable: false, title: '未实现', description: '该能力尚未实现' },
  CACHE_ERROR: { http: 500, retryable: false, title: '缓存错误', description: 'SQLite 读写失败' },
  INTERNAL: { http: 500, retryable: false, title: '内部错误', description: '未分类的客户端内部错误' },
} as const satisfies Record<string, ErrorCodeMeta>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ErrorCodeSchema = z
  .enum(Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]])
  .meta({ id: 'ErrorCode', description: '统一错误码' });

export class BossError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryAfterMs?: number;
  override readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: { details?: Record<string, unknown>; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message ?? ERROR_CATALOG[code].title);
    this.name = 'BossError';
    this.code = code;
    this.details = opts.details;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }

  get retryable(): boolean {
    return ERROR_CATALOG[this.code].retryable;
  }

  get httpStatus(): number {
    return ERROR_CATALOG[this.code].http;
  }

  toJSON(): {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function asBossError(err: unknown): BossError {
  if (err instanceof BossError) return err;
  if (err instanceof z.ZodError) {
    return new BossError('VALIDATION_FAILED', 'request validation failed', { details: { issues: err.issues } });
  }
  return new BossError('INTERNAL', err instanceof Error ? err.message : String(err), { cause: err });
}
