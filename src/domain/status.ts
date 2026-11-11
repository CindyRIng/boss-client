/**
 * 状态 / 健康检查领域模型
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const HealthValueSchema = z
  .enum(['ok', 'degraded', 'needs_human', 'cooldown', 'logged_out', 'stopped'])
  .meta({ id: 'HealthValue' });

export type HealthValue = z.infer<typeof HealthValueSchema>;

export const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal('boss-client'),
    version: z.string(),
    uptimeSec: z.number().int().nonnegative(),
    schemaVersion: z.literal('1.0'),
    browser: z.object({
      connected: z.boolean(),
      headless: z.boolean(),
      profileDir: z.string(),
    }),
    login: z.object({ loggedIn: z.boolean(), health: HealthValueSchema }),
    cache: z.object({ dbPath: z.string(), ready: z.boolean() }),
    ts: IsoDateTimeSchema,
  })
  .meta({ id: 'HealthResponse' });

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const StatusSchema = z
  .object({
    loggedIn: z.boolean(),
    health: HealthValueSchema,
    account: z
      .object({
        phoneMasked: z.string().optional(),
        nameMasked: z.string().optional(),
        isHunter: z.boolean().optional(),
        userIdTail: z.string().optional(),
      })
      .default({}),
    session: z
      .object({
        profileDir: z.string(),
        startedAt: IsoDateTimeSchema.optional(),
        lastCheckedAt: IsoDateTimeSchema.optional(),
        expiresAt: IsoDateTimeSchema.optional(),
        remainingSec: z.number().int().nonnegative().optional(),
      })
      .optional(),
    risk: z
      .object({
        cooldownUntil: IsoDateTimeSchema.nullable().optional(),
        code37Count: z.number().int().nonnegative(),
        lastError: z.string().nullable().optional(),
      })
      .default({ code37Count: 0 }),
    requests: z
      .object({
        today: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        cacheMisses: z.number().int().nonnegative(),
        lastUpstreamAt: IsoDateTimeSchema.optional(),
      })
      .default({ today: 0, cacheHits: 0, cacheMisses: 0 }),
    cache: z
      .object({
        dbPath: z.string(),
        sizeBytes: z.number().int().nonnegative().optional(),
        entries: z.record(z.string(), z.number().int().nonnegative()),
      })
      .optional(),
    warnings: z.array(z.string()).default([]),
    message: z.string().optional(),
  })
  .meta({ id: 'Status' });

export type Status = z.infer<typeof StatusSchema>;
