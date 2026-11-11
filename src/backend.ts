/**
 * 后端选择：本地 owner 进程 vs 远程 REST 代理
 *
 * - 常驻服务（systemd）是唯一持有 browser/profile 的 owner。
 * - CLI/MCP 默认优先走 BOSS_CLIENT_URL；未显式配置时探测本机 REST 服务。
 * - 只有 `--local` 或探测不到服务时才创建本地 App（用于单机独立运行）。
 */
import { createApp } from './app.js';
import { loadConfig, type Config } from './config/schema.js';
import type { BossService } from './service.js';
import { RemoteBossClient } from './remote/client.js';
import { BossError } from './errors/catalog.js';

export type BackendMode = 'auto' | 'local' | 'remote';

export interface Backend {
  config: Config;
  service: BossService;
  mode: 'local' | 'remote';
  close(): Promise<void>;
}

export interface CreateBackendOptions {
  mode?: BackendMode;
  url?: string;
}

async function probeHealth(config: Config): Promise<string | null> {
  const base = `http://${config.host}:${config.port}`;
  // health 会顺带检查登录态，服务繁忙时可能明显超过 1s；给足 8s 避免误判为“未运行”
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const payload = (await response.json()) as { ok?: boolean; data?: { service?: string } };
      if (payload.ok === true && payload.data?.service === 'boss-client') return base;
    } catch {
      /* retry */
    }
  }
  return null;
}

export async function createBackend(opts: CreateBackendOptions = {}): Promise<Backend> {
  const mode = opts.mode ?? 'auto';
  const config = loadConfig();
  const envUrl = opts.url ?? process.env.BOSS_CLIENT_URL;
  const defaultUrl = `http://${config.host}:${config.port}`;

  if (mode === 'remote') {
    // 默认代理到本机 REST（与 systemd/daemon 同端口），不再要求显式 BOSS_CLIENT_URL
    return {
      config,
      service: new RemoteBossClient(config, envUrl ?? defaultUrl),
      mode: 'remote',
      close: async () => {},
    };
  }

  if (mode === 'auto') {
    if (envUrl) {
      return { config, service: new RemoteBossClient(config, envUrl), mode: 'remote', close: async () => {} };
    }
    const detected = await probeHealth(config);
    if (detected) {
      return { config, service: new RemoteBossClient(config, detected), mode: 'remote', close: async () => {} };
    }
  }

  const app = await createApp({ logToStdout: false });
  return {
    config: app.config,
    service: app.service,
    mode: 'local',
    close: () => app.close(),
  };
}
