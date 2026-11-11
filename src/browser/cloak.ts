/**
 * cloak 浏览器宿主（cloakbrowser 0.6.5 + Playwright）
 */
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserHost, BrowserInfo, BrowserStartOptions } from './types.js';
import { BossError } from '../errors/catalog.js';

type LaunchPersistentContext = (opts: Record<string, unknown>) => Promise<BrowserContext>;

export class CloakBrowserHost implements BrowserHost {
  private ctx: BrowserContext | null = null;
  private pageRef: Page | null = null;
  private startedAt = 0;

  constructor(private readonly opts: BrowserStartOptions) {}

  async start(): Promise<void> {
    let mod: { launchPersistentContext?: LaunchPersistentContext };
    try {
      mod = (await import('cloakbrowser')) as unknown as { launchPersistentContext?: LaunchPersistentContext };
    } catch (err) {
      throw new BossError('NOT_IMPLEMENTED', 'cloakbrowser 未安装：请在 cloak-env 的 FHS 中运行（bin/boss-run）', { cause: err });
    }
    if (typeof mod.launchPersistentContext !== 'function') {
      throw new BossError('NOT_IMPLEMENTED', 'cloakbrowser API 不兼容：缺少 launchPersistentContext');
    }
    try {
      this.ctx = await mod.launchPersistentContext({
        userDataDir: this.opts.profileDir,
        headless: this.opts.headless,
        humanize: this.opts.humanize ?? true,
        timezone: this.opts.timezone ?? 'Asia/Shanghai',
        locale: this.opts.locale ?? 'zh-CN',
        viewport: this.opts.viewport ?? { width: 1440, height: 900 },
        args: this.opts.args ?? ['--start-maximized'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.opts.headless === false && /display|DISPLAY|X11|wayland|ozone/i.test(msg)) {
        throw new BossError('HEADFUL_REQUIRED', '无法打开可见浏览器：请设置 DISPLAY 或使用 Xvfb', { cause: err });
      }
      throw new BossError('UPSTREAM_UNAVAILABLE', `浏览器启动失败：${msg}`, { cause: err });
    }
    this.pageRef = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    this.startedAt = Date.now();
  }

  isConnected(): boolean {
    return this.ctx !== null && this.pageRef !== null;
  }

  context(): BrowserContext {
    if (!this.ctx) throw new BossError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.ctx;
  }

  page(): Page {
    if (!this.pageRef) throw new BossError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.pageRef;
  }

  info(): BrowserInfo {
    return {
      connected: this.isConnected(),
      headless: this.opts.headless,
      profileDir: this.opts.profileDir,
      ...(this.startedAt ? { browserVersion: 'cloak' } : {}),
    };
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.pageRef = null;
  }
}
