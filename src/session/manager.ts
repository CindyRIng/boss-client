/**
 * 会话管理器：浏览器生命周期 + 单实例锁 + 心跳 + 登录中继（QR/SMS/极验）
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { Config } from '../config/schema.js';
import type { BrowserHost } from '../browser/types.js';
import { CloakBrowserHost } from '../browser/cloak.js';
import { PageBossApiClient, type BossRequestStats } from '../adapters/boss/client.js';
import { BOSS_ENDPOINTS } from '../adapters/boss/endpoints.js';
import {
  captchaChallenge,
  clickSendSms,
  extractQr,
  fillPhoneAndAgree,
  openSmsTab,
  smsSent,
  solveCaptcha,
  submitSmsCode,
  sleep,
} from '../adapters/boss/extract.js';
import { BossError } from '../errors/catalog.js';
import type { Logger } from '../utils/logger.js';
import type { HealthValue, Status } from '../domain/status.js';
import type {
  CaptchaChallenge,
  LoginCaptchaRequest,
  LoginMode,
  LoginSession,
  LoginStartRequest,
  QrChallenge,
} from '../domain/login.js';
import { maskName, maskPhone } from '../domain/common.js';

interface LoginInternal {
  loginId: string;
  mode: LoginMode;
  state: LoginSession['state'];
  page: Page;
  phone?: string;
  phase: 'send' | 'login';
  createdAt: number;
  expiresAt: number;
  qr?: QrChallenge;
  captcha?: CaptchaChallenge;
  message?: string;
}

export interface SessionManager {
  ensureStarted(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  page(): Page;
  client(): PageBossApiClient;
  status(): Promise<Status>;
  isLoggedIn(): Promise<boolean>;
  loginStart(req: LoginStartRequest): Promise<LoginSession>;
  loginGet(loginId: string): Promise<LoginSession>;
  loginCaptcha(loginId: string, answer: LoginCaptchaRequest): Promise<LoginSession>;
  loginSms(loginId: string, code: string): Promise<LoginSession>;
  loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }>;
  requestStats(): BossRequestStats;
}

export class DefaultSessionManager implements SessionManager {
  private host: BrowserHost | null = null;
  private api: PageBossApiClient | null = null;
  private state: HealthValue = 'stopped';
  private startedAt: number | null = null;
  private lastCheckedAt: number | null = null;
  private starting: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lockFd: number | null = null;
  private lockPath: string | null = null;
  private login: LoginInternal | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly logger?: Logger,
  ) {}

  isRunning(): boolean {
    return this.host?.isConnected() ?? false;
  }

  async ensureStarted(): Promise<void> {
    if (this.isRunning()) return;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    this.acquireLock();
    try {
      this.state = 'stopped';
      const host = new CloakBrowserHost({
        headless: this.cfg.headless,
        profileDir: this.cfg.profileDir,
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        humanize: true,
      });
      await host.start();
      await host.page().goto(this.cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
      await host.page().waitForTimeout(2000);
      this.host = host;
      this.api = new PageBossApiClient(host.page(), {
        baseUrl: this.cfg.baseUrl,
        timeoutMs: this.cfg.session.requestTimeoutMs,
        ratePerMin: this.cfg.session.ratePerMin,
        pageJitterMs: 300,
      });
      this.startedAt = Date.now();
      const loggedIn = await this.isLoggedIn().catch(() => false);
      this.state = loggedIn ? 'ok' : 'needs_human';
      this.lastCheckedAt = Date.now();
      this.startHeartbeat();
      this.logger?.info('session.started', {
        profileDir: this.cfg.profileDir,
        headless: this.cfg.headless,
        loggedIn,
      });
    } catch (err) {
      this.releaseLock();
      this.state = 'stopped';
      throw err instanceof BossError ? err : new BossError('UPSTREAM_UNAVAILABLE', `浏览器启动失败：${String(err)}`, { cause: err });
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    await this.host?.close().catch(() => {});
    this.host = null;
    this.api = null;
    this.startedAt = null;
    this.state = 'stopped';
    this.login = null;
    this.releaseLock();
    this.logger?.info('session.stopped');
  }

  page(): Page {
    if (!this.host) throw new BossError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.host.page();
  }

  client(): PageBossApiClient {
    if (!this.api) throw new BossError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.api;
  }

  requestStats(): BossRequestStats {
    return this.api?.stats() ?? { requests: 0, code37Count: 0 };
  }

  async isLoggedIn(): Promise<boolean> {
    if (!this.api) return false;
    try {
      const info = await this.api.getUserInfo();
      return Boolean(info?.userId);
    } catch {
      return false;
    }
  }

  async status(): Promise<Status> {
    const profileDir = this.cfg.profileDir;
    if (!this.host || !this.api) {
      return {
        loggedIn: false,
        health: 'stopped',
        account: {},
        session: { profileDir },
        risk: { code37Count: 0 },
        requests: { today: 0, cacheHits: 0, cacheMisses: 0 },
        warnings: [],
        message: '浏览器会话未启动：请执行 `boss login`',
      };
    }
    const user = await this.api.getUserInfo().catch(() => null);
    const loggedIn = Boolean(user?.userId);
    this.lastCheckedAt = Date.now();
    const session = await this.sessionInfo();
    const riskStats = this.api.stats();
    const warnings: string[] = [];
    if (session.remainingSec !== undefined && session.remainingSec < 24 * 3600) {
      warnings.push('session_expiring_soon');
    }
    if (riskStats.cooldownUntil && riskStats.cooldownUntil > Date.now()) warnings.push('upstream_cooldown');
    let health: HealthValue;
    if (riskStats.cooldownUntil && riskStats.cooldownUntil > Date.now()) health = 'cooldown';
    else if (!loggedIn) health = this.login ? 'needs_human' : 'logged_out';
    else if (session.remainingSec !== undefined && session.remainingSec < 24 * 3600) health = 'degraded';
    else health = 'ok';
    this.state = health;
    return {
      loggedIn,
      health,
      account: {
        ...(this.cfg.phone ? { phoneMasked: maskPhone(this.cfg.phone) } : {}),
        ...(user?.name ? { nameMasked: maskName(user.name) } : {}),
        ...(user?.isHunter !== undefined ? { isHunter: user.isHunter } : {}),
        ...(user?.userId ? { userIdTail: user.userId.slice(-3) } : {}),
      },
      session: { profileDir, ...(this.startedAt ? { startedAt: new Date(this.startedAt).toISOString() } : {}), ...(this.lastCheckedAt ? { lastCheckedAt: new Date(this.lastCheckedAt).toISOString() } : {}), ...session },
      risk: {
        ...(riskStats.cooldownUntil ? { cooldownUntil: new Date(riskStats.cooldownUntil).toISOString() } : {}),
        code37Count: riskStats.code37Count,
        ...(riskStats.lastError ? { lastError: riskStats.lastError } : {}),
      },
      requests: {
        today: riskStats.requests,
        cacheHits: 0,
        cacheMisses: 0,
        ...(riskStats.lastUpstreamAt ? { lastUpstreamAt: new Date(riskStats.lastUpstreamAt).toISOString() } : {}),
      },
      warnings,
      ...(loggedIn ? {} : { message: 'BOSS 登录态不可用，请执行 `boss login`' }),
    };
  }

  private async sessionInfo(): Promise<{ expiresAt?: string; remainingSec?: number }> {
    let expiresAt: string | undefined;
    let remainingSec: number | undefined;
    try {
      const ctx: BrowserContext = this.host!.context();
      const cookies = await ctx.cookies(this.cfg.baseUrl);
      const c = cookies.find((x) => x.name === 'wt2') ?? cookies.find((x) => x.name === 'zp_at');
      if (c && c.expires > 0) {
        const ms = c.expires * 1000;
        expiresAt = new Date(ms).toISOString();
        remainingSec = Math.max(0, Math.floor((ms - Date.now()) / 1000));
      }
    } catch {
      /* ignore */
    }
    return { ...(expiresAt ? { expiresAt } : {}), ...(remainingSec !== undefined ? { remainingSec } : {}) };
  }

  /* ---------------- login relay ---------------- */

  async loginStart(req: LoginStartRequest): Promise<LoginSession> {
    await this.ensureStarted();
    if (await this.isLoggedIn()) {
      const id = this.newLoginId();
      return {
        loginId: id,
        mode: req.mode,
        state: 'logged_in',
        expiresAt: new Date(Date.now() + this.cfg.session.loginTimeoutSec * 1000).toISOString(),
        message: 'already logged in',
      };
    }
    if (this.cfg.headless) {
      throw new BossError('HEADFUL_REQUIRED', '登录/验证码需要 headful 浏览器：请设置 BOSS_HEADLESS=false，或使用 Xvfb');
    }
    if (this.login && this.login.expiresAt > Date.now()) {
      throw new BossError('LOGIN_IN_PROGRESS', `已有登录流程进行中：${this.login.loginId}`);
    }
    const page = this.page();
    const loginId = this.newLoginId();
    const phone = req.phone ?? this.cfg.phone;
    const internal: LoginInternal = {
      loginId,
      mode: req.mode,
      state: 'starting',
      page,
      phase: 'send',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.cfg.session.loginTimeoutSec * 1000,
      ...(phone ? { phone } : {}),
    };
    this.login = internal;
    try {
      await page.goto(this.cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
      await sleep(4000);
      if (req.mode === 'qr') {
        const qr = await extractQr(page);
        if (!qr) throw new BossError('UPSTREAM_CHANGED', '未找到二维码，可能是登录页改版');
        internal.qr = {
          pngBase64: qr.pngBase64,
          image: { width: qr.width, height: qr.height },
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        };
        internal.state = 'awaiting_scan';
        return this.toPublic(internal);
      }
      if (!phone) throw new BossError('BAD_REQUEST', '短信登录需要手机号：设置 BOSS_PHONE 或传入 phone');
      await openSmsTab(page);
      await fillPhoneAndAgree(page, phone);
      await clickSendSms(page);
      const challenge = await captchaChallenge(page);
      if (challenge) {
        internal.captcha = challenge;
        internal.state = 'awaiting_captcha';
        return this.toPublic(internal);
      }
      const sent = await this.waitSmsSent(15000);
      internal.state = sent ? 'awaiting_sms_code' : 'failed';
      if (!sent) internal.message = '短信未确认发送，请重试';
      return this.toPublic(internal);
    } catch (err) {
      this.login = null;
      throw err;
    }
  }

  async loginGet(loginId: string): Promise<LoginSession> {
    const internal = this.findLogin(loginId);
    if (internal.expiresAt < Date.now()) {
      internal.state = 'expired';
      this.login = null;
      throw new BossError('LOGIN_EXPIRED', '登录流程已过期，请重新开始');
    }
    if (internal.state === 'logged_in') return this.toPublic(internal);
    if (await this.isLoggedIn()) {
      await this.completeLogin(internal);
      return this.toPublic(internal);
    }
    if (internal.state === 'awaiting_scan') {
      const qr = await extractQr(internal.page).catch(() => null);
      if (qr) {
        internal.qr = {
          pngBase64: qr.pngBase64,
          image: { width: qr.width, height: qr.height },
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        };
      }
    } else if (internal.state === 'awaiting_captcha') {
      const challenge = await captchaChallenge(internal.page);
      if (challenge) {
        internal.captcha = challenge;
      } else if (internal.phase === 'send' && (await smsSent(internal.page))) {
        internal.captcha = undefined;
        internal.state = 'awaiting_sms_code';
      } else if (internal.phase === 'login') {
        if (await this.isLoggedIn()) {
          await this.completeLogin(internal);
        } else {
          internal.captcha = undefined;
          internal.state = 'awaiting_sms_code';
          internal.message = '验证码已通过，请重新提交短信码';
        }
      }
    } else if (internal.state === 'awaiting_sms_code') {
      /* wait for user code */
    }
    return this.toPublic(internal);
  }

  async loginCaptcha(loginId: string, answer: LoginCaptchaRequest): Promise<LoginSession> {
    const internal = this.findLogin(loginId);
    if (internal.expiresAt < Date.now()) throw new BossError('LOGIN_EXPIRED', '登录流程已过期');
    if (answer.kind === 'slider' && answer.offsetRatio === undefined && answer.offsetPx === undefined) {
      throw new BossError('BAD_REQUEST', '滑块验证码需要 offsetRatio 或 offsetPx');
    }
    try {
      await solveCaptcha(internal.page, answer);
    } catch (err) {
      if (err instanceof BossError && err.code === 'CAPTCHA_INVALID') {
        const fresh = (err.details?.captcha as CaptchaChallenge | undefined) ?? (await captchaChallenge(internal.page)) ?? undefined;
        if (fresh) internal.captcha = fresh;
        internal.state = 'awaiting_captcha';
        throw err;
      }
      throw err;
    }
    internal.captcha = undefined;
    if (internal.phase === 'send') {
      let sent = await this.waitSmsSent(5000);
      if (!sent) {
        await clickSendSms(internal.page).catch(() => {});
        sent = await this.waitSmsSent(10000);
      }
      internal.state = sent ? 'awaiting_sms_code' : 'failed';
      if (!sent) internal.message = '验证码已通过，但短信未确认发送；请重试或检查短信频控';
      return this.toPublic(internal);
    }
    // phase=login: 短信码已提交，验证码通过后等待登录
    const ok = await this.waitLoggedIn(60000);
    if (ok) {
      await this.completeLogin(internal);
      return this.toPublic(internal);
    }
    internal.state = 'awaiting_sms_code';
    internal.message = '验证码已通过，但登录未完成；请重新提交短信码';
    return this.toPublic(internal);
  }

  async loginSms(loginId: string, code: string): Promise<LoginSession> {
    const internal = this.findLogin(loginId);
    if (internal.expiresAt < Date.now()) throw new BossError('LOGIN_EXPIRED', '登录流程已过期');
    await submitSmsCode(internal.page, code);
    const challenge = await captchaChallenge(internal.page);
    if (challenge) {
      internal.captcha = challenge;
      internal.phase = 'login';
      internal.state = 'awaiting_captcha';
      throw new BossError('CAPTCHA_REQUIRED', '登录时出现极验验证码', { details: { loginId, captcha: challenge } });
    }
    const ok = await this.waitLoggedIn(60000);
    if (!ok) {
      internal.state = 'awaiting_sms_code';
      throw new BossError('SMS_CODE_INVALID', '短信验证码未通过或登录未完成，请重试');
    }
    await this.completeLogin(internal);
    return this.toPublic(internal);
  }

  async loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }> {
    const internal = this.findLogin(loginId);
    internal.state = 'cancelled';
    this.login = null;
    return { loginId, state: 'cancelled' };
  }

  private newLoginId(): string {
    return `login_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private findLogin(loginId: string): LoginInternal {
    if (!this.login || this.login.loginId !== loginId) {
      throw new BossError('LOGIN_EXPIRED', `登录流程不存在或已过期：${loginId}`);
    }
    return this.login;
  }

  private async waitSmsSent(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await smsSent(this.page())) return true;
      await sleep(1000);
    }
    return false;
  }

  private async waitLoggedIn(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isLoggedIn()) return true;
      await sleep(2000);
    }
    return false;
  }

  private async completeLogin(internal: LoginInternal): Promise<void> {
    internal.state = 'logged_in';
    internal.message = 'logged in';
    this.state = 'ok';
    this.lastCheckedAt = Date.now();
    try {
      await this.host!.context().storageState({ path: path.join(path.dirname(this.cfg.profileDir), 'session.json') });
      fs.chmodSync(path.join(path.dirname(this.cfg.profileDir), 'session.json'), 0o600);
    } catch {
      /* profile itself persists; storage state is a bonus */
    }
    this.logger?.info('session.login.ok', { loginId: internal.loginId, mode: internal.mode });
  }

  private toPublic(internal: LoginInternal): LoginSession {
    return {
      loginId: internal.loginId,
      mode: internal.mode,
      state: internal.state,
      ...(internal.phone ? { phoneMasked: maskPhone(internal.phone) } : {}),
      ...(internal.qr ? { qr: internal.qr } : {}),
      ...(internal.captcha ? { captcha: internal.captcha } : {}),
      expiresAt: new Date(internal.expiresAt).toISOString(),
      ...(internal.message ? { message: internal.message } : {}),
    };
  }

  /* ---------------- lock / heartbeat ---------------- */

  private acquireLock(): void {
    const dir = path.join(path.dirname(this.cfg.profileDir), 'run');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(dir, 'boss.lock');
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      this.lockFd = fd;
      this.lockPath = lockPath;
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          throw new BossError('ALREADY_RUNNING', `boss-client 已在运行（pid=${pid}）`);
        } catch (killErr) {
          if (killErr instanceof BossError) throw killErr;
          /* stale pid */
        }
      }
      fs.unlinkSync(lockPath);
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      this.lockFd = fd;
      this.lockPath = lockPath;
    }
  }

  private releaseLock(): void {
    if (this.lockFd !== null) {
      try {
        fs.closeSync(this.lockFd);
      } catch {
        /* ignore */
      }
      this.lockFd = null;
    }
    if (this.lockPath) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        /* ignore */
      }
      this.lockPath = null;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const interval = Math.max(30, this.cfg.session.heartbeatSec) * 1000;
    this.heartbeatTimer = setInterval(() => {
      this.status()
        .then((s) => this.logger?.debug('session.heartbeat', { health: s.health, loggedIn: s.loggedIn }))
        .catch(() => {});
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export { BOSS_ENDPOINTS };
