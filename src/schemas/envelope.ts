/**
 * 统一响应包（Envelope）
 */
import { z } from 'zod';
import { ErrorCodeSchema } from '../errors/catalog.js';
import { IsoDateTimeSchema, RequestIdSchema } from '../domain/common.js';

export const SCHEMA_VERSION = '1.0';

export const PaginationMetaSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    pagesFetched: z.number().int().nonnegative().optional(),
    pagesAvailable: z.number().int().nonnegative().optional(),
  })
  .meta({ id: 'PaginationMeta' });

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const ResponseMetaSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    requestId: RequestIdSchema,
    timestamp: IsoDateTimeSchema,
    tookMs: z.number().int().nonnegative(),
    cached: z.boolean().default(false),
    pagination: PaginationMetaSchema.optional(),
    warnings: z.array(z.string()).default([]),
    upstream: z
      .object({
        baseUrl: z.string().optional(),
        latencyMs: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .meta({ id: 'ResponseMeta' });

export const ApiErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ApiError' });

export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  meta: z.infer<typeof ResponseMetaSchema>;
  error: null;
}

export interface FailureEnvelope {
  ok: false;
  data: null;
  meta: z.infer<typeof ResponseMetaSchema>;
  error: ApiError;
}

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export function successEnvelope<T>(data: T, meta: Omit<z.infer<typeof ResponseMetaSchema>, 'schemaVersion' | 'timestamp' | 'cached' | 'warnings'> & {
  cached?: boolean;
  warnings?: string[];
  timestamp?: string;
}): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    meta: {
      schemaVersion: SCHEMA_VERSION,
      timestamp: meta.timestamp ?? new Date().toISOString(),
      cached: meta.cached ?? false,
      warnings: meta.warnings ?? [],
      ...meta,
    },
    error: null,
  };
}

export function failureEnvelope(error: ApiError, meta: { requestId: string; tookMs: number; warnings?: string[] }): FailureEnvelope {
  return {
    ok: false,
    data: null,
    meta: {
      schemaVersion: SCHEMA_VERSION,
      requestId: meta.requestId,
      timestamp: new Date().toISOString(),
      tookMs: meta.tookMs,
      cached: false,
      warnings: meta.warnings ?? [],
    },
    error,
  };
}

export function envelopeSchemaFor<T extends z.ZodTypeAny>(dataSchema: T, id = 'BossEnvelope') {
  return z
    .union([
      z.object({ ok: z.literal(true), data: dataSchema, meta: ResponseMetaSchema, error: z.null() }),
      z.object({ ok: z.literal(false), data: z.null(), meta: ResponseMetaSchema, error: ApiErrorSchema }),
    ])
    .meta({ id });
}
