import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config/schema.js';
import { RemoteBossClient } from '../src/remote/client.js';
import { createBackend } from '../src/backend.js';
import { BossError } from '../src/errors/catalog.js';

const servers: http.Server[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of servers.splice(0)) s.close();
});

async function startServer(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

function envelope(data: unknown) {
  return JSON.stringify({ ok: true, data, meta: { schemaVersion: '1.0' }, error: null });
}

describe('remote backend', () => {
  it('RemoteBossClient calls REST and unwraps envelope', async () => {
    const port = await startServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/v1/health')) res.end(envelope({ service: 'boss-client', ok: true }));
      else if (req.url?.startsWith('/v1/status')) res.end(envelope({ loggedIn: true, health: 'ok' }));
      else res.end(JSON.stringify({ ok: false, data: null, meta: {}, error: { code: 'CACHE_ERROR', message: 'boom', retryable: false } }));
    });
    const config = loadConfig({ env: { BOSS_PORT: String(port), BOSS_API_TOKEN: 'test-token' } });
    const client = new RemoteBossClient(config, `http://127.0.0.1:${port}`);
    expect((await client.health()).service).toBe('boss-client');
    expect((await client.status()).loggedIn).toBe(true);
    await expect(client.cacheStats()).rejects.toMatchObject({ code: 'CACHE_ERROR' });
  });

  it('createBackend auto-detects a running boss-client REST service', async () => {
    const port = await startServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(envelope({ ok: true, service: 'boss-client' }));
    });
    vi.stubEnv('BOSS_CLIENT_URL', '');
    vi.stubEnv('BOSS_PORT', String(port));
    vi.stubEnv('BOSS_API_TOKEN', 'test-token');
    const backend = await createBackend({ mode: 'auto' });
    expect(backend.mode).toBe('remote');
    await backend.close();
  });

  it('BossError is used for unreachable service', async () => {
    vi.stubEnv('BOSS_CLIENT_URL', 'http://127.0.0.1:1');
    vi.stubEnv('BOSS_API_TOKEN', 'test-token');
    const client = new RemoteBossClient(loadConfig(), 'http://127.0.0.1:1');
    await expect(client.status()).rejects.toBeInstanceOf(BossError);
  });
});
