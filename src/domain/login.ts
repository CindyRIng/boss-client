/**
 * 登录领域模型（QR / 短信 / 验证码中继）
 */
import { z } from 'zod';
import { IsoDateTimeSchema, LoginIdSchema } from './common.js';

export const LoginModeSchema = z.enum(['sms', 'qr']).meta({ id: 'LoginMode' });
export type LoginMode = z.infer<typeof LoginModeSchema>;

export const LoginStateSchema = z
  .enum(['starting', 'awaiting_scan', 'awaiting_captcha', 'awaiting_sms_code', 'logged_in', 'failed', 'expired', 'cancelled'])
  .meta({ id: 'LoginState' });
export type LoginState = z.infer<typeof LoginStateSchema>;

export const CaptchaImageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const CaptchaChallengeSchema = z
  .object({
    kind: z.enum(['click', 'slider']),
    prompt: z.string().optional(),
    image: CaptchaImageSchema,
    mainBase64: z.string().optional().describe('主图 PNG base64（click/slider）'),
    tipBase64: z.string().optional().describe('提示图 PNG base64（click）'),
    screenshotBase64: z.string().optional().describe('完整面板截图 base64'),
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'CaptchaChallenge' });

export type CaptchaChallenge = z.infer<typeof CaptchaChallengeSchema>;

export const QrChallengeSchema = z
  .object({
    pngBase64: z.string(),
    image: CaptchaImageSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'QrChallenge' });

export const LoginSessionSchema = z
  .object({
    loginId: LoginIdSchema,
    mode: LoginModeSchema,
    state: LoginStateSchema,
    phoneMasked: z.string().optional(),
    qr: QrChallengeSchema.nullable().optional(),
    captcha: CaptchaChallengeSchema.nullable().optional(),
    expiresAt: IsoDateTimeSchema,
    message: z.string().optional(),
  })
  .meta({ id: 'LoginSession' });

export type LoginSession = z.infer<typeof LoginSessionSchema>;

export type QrChallenge = z.infer<typeof QrChallengeSchema>;

export const LoginStartRequestSchema = z
  .object({
    mode: LoginModeSchema.default('sms'),
    phone: z.string().regex(/^1[3-9]\d{9}$/).optional(),
  })
  .meta({ id: 'LoginStartRequest' });

export type LoginStartRequest = z.infer<typeof LoginStartRequestSchema>;

export const LoginClickPointsSchema = z
  .object({
    kind: z.literal('click'),
    points: z
      .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
      .min(1)
      .max(6),
  })
  .meta({ id: 'LoginClickPoints' });

export const LoginSliderSchema = z
  .object({
    kind: z.literal('slider'),
    offsetRatio: z.number().min(0).max(1).optional(),
    offsetPx: z.number().min(0).optional(),
  })
  .meta({ id: 'LoginSlider' });

export const LoginCaptchaRequestSchema = z
  .discriminatedUnion('kind', [LoginClickPointsSchema, LoginSliderSchema])
  .meta({ id: 'LoginCaptchaRequest' });

export type LoginCaptchaRequest = z.infer<typeof LoginCaptchaRequestSchema>;

export const LoginSmsRequestSchema = z
  .object({
    code: z.string().regex(/^\d{4,8}$/),
  })
  .meta({ id: 'LoginSmsRequest' });

export const LoginCancelResponseSchema = z
  .object({
    loginId: LoginIdSchema,
    state: z.literal('cancelled'),
  })
  .meta({ id: 'LoginCancelResponse' });
