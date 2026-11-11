/**
 * 浏览器宿主抽象（Playwright Page/Context 直出，便于登录/提取逻辑）
 */
import type { BrowserContext, Page } from 'playwright-core';

export interface BrowserStartOptions {
  headless: boolean;
  profileDir: string;
  humanize?: boolean;
  timezone?: string;
  locale?: string;
  viewport?: { width: number; height: number };
  args?: string[];
}

export interface BrowserInfo {
  connected: boolean;
  headless: boolean;
  profileDir: string;
  browserVersion?: string;
  pid?: number;
}

export interface BrowserHost {
  start(): Promise<void>;
  isConnected(): boolean;
  context(): BrowserContext;
  page(): Page;
  info(): BrowserInfo;
  close(): Promise<void>;
}
