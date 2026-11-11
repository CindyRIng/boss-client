/**
 * CLI 入口
 */
import readline from 'node:readline/promises';
import { Command } from 'commander';
import { createApp, type App } from '../../app.js';
import { createBackend } from '../../backend.js';
import { loadConfig } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { RemoteBossClient } from '../../remote/client.js';
import { asBossError } from '../../errors/catalog.js';
import { failureEnvelope, successEnvelope } from '../../schemas/envelope.js';
import type { LoginCaptchaRequest, LoginSession } from '../../domain/login.js';
import { renderQrTerminal } from './qr.js';

const VERSION = '0.1.0';
let app: App | null = null;

async function getApp(): Promise<App> {
  if (!app) {
    if (process.env.BOSS_CLIENT_URL) {
      const config = loadConfig();
      app = {
        config,
        service: new RemoteBossClient(config),
        cache: {} as never,
        session: {} as never,
        logger: createLogger({ level: 'error', stdout: false }),
        close: async () => {},
      };
    } else {
      app = await createApp();
    }
  }
  return app;
}

async function closeApp(): Promise<void> {
  if (app) {
    await app.close().catch(() => {});
    app = null;
  }
}

function rid(): string {
  return `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function printJson(data: unknown, meta: { pagination?: unknown; cached?: boolean } = {}): void {
  console.log(
    JSON.stringify(
      successEnvelope(data, {
        requestId: rid(),
        tookMs: 0,
        cached: meta.cached ?? false,
        ...(meta.pagination ? { pagination: meta.pagination as never } : {}),
      }),
      null,
      2,
    ),
  );
}

function printError(err: unknown): void {
  const e = asBossError(err);
  console.error(JSON.stringify(failureEnvelope(e.toJSON(), { requestId: rid(), tookMs: 0 }), null, 2));
  process.exitCode = 1;
}

function printTable(data: unknown): void {
  const d = data as Record<string, unknown>;
  const jobs = Array.isArray(d.jobs) ? (d.jobs as Array<Record<string, unknown>>) : null;
  if (jobs) {
    for (const j of jobs) {
      console.log([j.title, j.salaryText, j.companyName, j.cityName, j.experience, j.degree].map((x) => String(x ?? '')).join('\t'));
    }
    return;
  }
  const companies = Array.isArray(d.companies) ? (d.companies as Array<Record<string, unknown>>) : null;
  if (companies) {
    for (const c of companies) {
      console.log([c.name, c.jobCount, c.industry, c.scale, c.cityName].map((x) => String(x ?? '')).join('\t'));
    }
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

function parsePoints(raw: string): Array<{ x: number; y: number }> {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) throw new Error(`invalid point: ${pair}`);
      return { x, y };
    });
}

async function interactiveLogin(session: LoginSession): Promise<void> {
  const a = await getApp();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let last = session;
  try {
    if (session.state === 'logged_in') {
      console.log('已登录');
      return;
    }
    if (session.qr?.pngBase64) {
      console.log(renderQrTerminal(session.qr.pngBase64));
      console.log('请用 BOSS App 扫码；等待登录...');
    }
    if (session.captcha) {
      console.log('浏览器中已弹出验证码：请在 headful 浏览器完成验证；或使用 `boss login captcha` / REST 提交答案。');
    }
    const deadline = Date.now() + a.config.session.loginTimeoutSec * 1000;
    while (Date.now() < deadline) {
      const cur = await a.service.loginGet(session.loginId).catch((err) => {
        const e = asBossError(err);
        if (e.code === 'LOGIN_EXPIRED' || e.code === 'LOGIN_CANCELLED') throw e;
        return null;
      });
      if (!cur) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (cur.state !== last.state) {
        console.log(`[login] state=${cur.state}${cur.message ? ` (${cur.message})` : ''}`);
        last = cur;
      }
      if (cur.state === 'logged_in') {
        console.log('登录成功');
        return;
      }
      if (cur.state === 'failed' || cur.state === 'expired' || cur.state === 'cancelled') {
        throw new Error(`登录失败：${cur.state}${cur.message ? ` ${cur.message}` : ''}`);
      }
      if (cur.state === 'awaiting_sms_code') {
        const code = (await rl.question('请输入短信验证码：')).trim();
        if (!/^\d{4,8}$/.test(code)) {
          console.log('验证码格式不对，请重试');
          continue;
        }
        try {
          const done = await a.service.loginSms(session.loginId, code);
          if (done.state === 'logged_in') {
            console.log('登录成功');
            return;
          }
        } catch (err) {
          const e = asBossError(err);
          if (e.code === 'CAPTCHA_REQUIRED') {
            console.log('登录时又出现验证码：请在浏览器完成，或使用 `boss login captcha`。');
            continue;
          }
          console.log(`登录失败：${e.message}`);
        }
      } else if (cur.state === 'awaiting_scan') {
        if (cur.qr?.pngBase64 && cur.qr.pngBase64 !== last.qr?.pngBase64) {
          console.log(renderQrTerminal(cur.qr.pngBase64));
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('登录超时');
  } finally {
    rl.close();
  }
}

function buildProgram(): Command {
  const program = new Command();
  program.name('boss').version(VERSION).description('BOSS直聘本地只读客户端（cloak 浏览器 + CLI/REST/MCP）');
  program.option('--format <format>', '输出格式：json | table', 'json');

  const run = async (fn: (a: App) => Promise<unknown>, opts: { table?: boolean } = {}): Promise<void> => {
    try {
      const a = await getApp();
      const data = await fn(a);
      if (opts.table && program.opts().format === 'table') printTable(data);
      else printJson(data);
    } catch (err) {
      printError(err);
    } finally {
      await closeApp();
    }
  };

  program
    .command('health')
    .description('健康检查')
    .action(async () => run(async (a) => a.service.health()));

  program
    .command('status')
    .description('登录态 / 会话 / 风控 / 缓存')
    .action(async () => run(async (a) => a.service.status()));

  const login = program.command('login').description('登录（默认短信；--qr 扫码）');
  login
    .option('--sms', '短信验证码（默认）')
    .option('--qr', '二维码')
    .option('--phone <phone>', '手机号（默认 BOSS_PHONE）')
    .option('--relay', '只启动并输出 LoginSession（含 base64），不进入交互')
    .action(async (opts: { sms?: boolean; qr?: boolean; phone?: string; relay?: boolean }) => {
      try {
        const a = await getApp();
        const mode = opts.qr ? 'qr' : opts.sms ? 'sms' : a.config.headless ? 'qr' : 'sms';
        const session = await a.service.loginStart({ mode, ...(opts.phone ? { phone: opts.phone } : {}) });
        if (opts.relay) {
          printJson(session);
          await closeApp();
          return;
        }
        await interactiveLogin(session);
      } catch (err) {
        printError(err);
      } finally {
        await closeApp();
      }
    });

  login
    .command('start')
    .description('开始登录流程')
    .option('--sms', '短信验证码（默认）')
    .option('--qr', '二维码')
    .option('--phone <phone>', '手机号')
    .option('--relay', '只输出 LoginSession，不进入交互')
    .action(async (opts: { sms?: boolean; qr?: boolean; phone?: string; relay?: boolean }) => {
      try {
        const a = await getApp();
        const mode = opts.qr ? 'qr' : opts.sms ? 'sms' : a.config.headless ? 'qr' : 'sms';
        const session = await a.service.loginStart({ mode, ...(opts.phone ? { phone: opts.phone } : {}) });
        if (opts.relay) {
          printJson(session);
        } else {
          await interactiveLogin(session);
        }
      } catch (err) {
        printError(err);
      } finally {
        await closeApp();
      }
    });

  login
    .command('status')
    .argument('<loginId>')
    .description('查询登录流程状态')
    .action(async (loginId: string) => run(async (a) => a.service.loginGet(loginId)));

  login
    .command('captcha')
    .argument('<loginId>')
    .option('--points <points>', '点击坐标，空格分隔，如 "0.68,0.62 0.17,0.54"')
    .option('--offset-ratio <ratio>', '滑块偏移比例 0-1')
    .description('提交极验答案')
    .action(async (loginId: string, opts: { points?: string; offsetRatio?: string }) => {
      try {
        const a = await getApp();
        let answer: LoginCaptchaRequest;
        if (opts.points) answer = { kind: 'click', points: parsePoints(opts.points) };
        else if (opts.offsetRatio) answer = { kind: 'slider', offsetRatio: Number(opts.offsetRatio) };
        else throw new Error('需要 --points 或 --offset-ratio');
        printJson(await a.service.loginCaptcha(loginId, answer));
      } catch (err) {
        printError(err);
      } finally {
        await closeApp();
      }
    });

  login
    .command('sms')
    .argument('<loginId>')
    .requiredOption('--code <code>', '短信验证码')
    .description('提交短信验证码')
    .action(async (loginId: string, opts: { code: string }) => {
      try {
        const a = await getApp();
        printJson(await a.service.loginSms(loginId, opts.code));
      } catch (err) {
        printError(err);
      } finally {
        await closeApp();
      }
    });

  login
    .command('cancel')
    .argument('<loginId>')
    .description('取消登录流程')
    .action(async (loginId: string) => run(async (a) => a.service.loginCancel(loginId)));

  program
    .command('search')
    .command('jobs')
    .description('岗位搜索')
    .requiredOption('--keyword <keyword>', '关键词')
    .option('--city <cityCode>', '城市码，默认配置城市')
    .option('--page <page>', '页码', '1')
    .option('--page-size <pageSize>', '每页条数', '15')
    .option('--pages <pages>', '本次抓取页数 1-5', '1')
    .action(async (opts: { keyword: string; city?: string; page: string; pageSize: string; pages: string }) =>
      run(
        async (a) =>
          a.service.searchJobs({
            keyword: opts.keyword,
            ...(opts.city ? { cityCode: opts.city } : {}),
            page: Number(opts.page),
            pageSize: Number(opts.pageSize),
            pages: Number(opts.pages),
            refresh: false,
          }),
        { table: true },
      ),
    );

  const jobsCmd = program.command('jobs');
  jobsCmd
    .command('list')
    .description('按 queryId 翻页')
    .requiredOption('--query-id <queryId>')
    .option('--page <page>', '页码', '1')
    .option('--page-size <pageSize>', '每页条数', '15')
    .action(async (opts: { queryId: string; page: string; pageSize: string }) =>
      run(async (a) => a.service.listJobs({ queryId: opts.queryId, page: Number(opts.page), pageSize: Number(opts.pageSize) }), { table: true }),
    );

  jobsCmd
    .command('detail')
    .description('岗位详情')
    .requiredOption('--job-id <jobId>')
    .option('--security-id <securityId>')
    .option('--lid <lid>')
    .action(async (opts: { jobId: string; securityId?: string; lid?: string }) =>
      run(async (a) => a.service.jobDetail({ jobId: opts.jobId, ...(opts.securityId ? { securityId: opts.securityId } : {}), ...(opts.lid ? { lid: opts.lid } : {}) })),
    );

  const companiesCmd = program.command('companies');
  companiesCmd
    .command('list')
    .description('去重公司列表')
    .requiredOption('--query-id <queryId>')
    .option('--page <page>', '页码', '1')
    .option('--page-size <pageSize>', '每页条数', '20')
    .option('--fetch-pages <n>', '额外抓取页数 0-5', '0')
    .action(async (opts: { queryId: string; page: string; pageSize: string; fetchPages: string }) =>
      run(
        async (a) =>
          a.service.listCompanies({
            queryId: opts.queryId,
            page: Number(opts.page),
            pageSize: Number(opts.pageSize),
            fetchPages: Number(opts.fetchPages),
          }),
        { table: true },
      ),
    );

  companiesCmd
    .command('detail')
    .description('公司详情（含工商信息）')
    .requiredOption('--id <companyId>')
    .action(async (opts: { id: string }) => run(async (a) => a.service.companyDetail({ companyId: opts.id })));

  companiesCmd
    .command('jobs')
    .description('公司全部在招职位')
    .requiredOption('--id <companyId>')
    .action(async (opts: { id: string }) => run(async (a) => a.service.companyJobs({ companyId: opts.id })));

  program
    .command('cities')
    .command('list')
    .description('城市注册表')
    .option('--refresh', '从 BOSS 城市接口刷新')
    .action(async (opts: { refresh?: boolean }) => run(async (a) => a.service.cities(Boolean(opts.refresh))));

  const cacheCmd = program.command('cache');
  cacheCmd
    .command('stats')
    .description('缓存统计')
    .action(async () => run(async (a) => a.service.cacheStats()));

  cacheCmd
    .command('clear')
    .description('清缓存')
    .option('--all', '清全部')
    .option('--expired', '只清过期')
    .option('--prefix <prefix>', '按前缀清')
    .action(async (opts: { all?: boolean; expired?: boolean; prefix?: string }) =>
      run(async (a) =>
        a.service.cacheClear({
          scope: opts.expired ? 'expired' : 'all',
          ...(opts.prefix ? { prefix: opts.prefix } : {}),
        }),
      ),
    );

  program
    .command('serve')
    .description('启动本地 REST 服务')
    .option('--port <port>', '端口', '8790')
    .option('--host <host>', '监听地址', '127.0.0.1')
    .action(async (opts: { port: string; host: string }) => {
      try {
        const a = await createApp();
        const { createRestServer } = await import('../rest/server.js');
        const server = createRestServer(a);
        await new Promise<void>((resolve) => {
          server.listen(Number(opts.port), opts.host, () => {
            console.error(`[rest] boss-client listening on http://${opts.host}:${opts.port}`);
            console.error(`[rest] docs: http://${opts.host}:${opts.port}/docs`);
          });
          const shutdown = () => {
            server.close(() => resolve());
            void closeApp();
          };
          process.once('SIGINT', shutdown);
          process.once('SIGTERM', shutdown);
        });
      } catch (err) {
        printError(err);
        await closeApp();
      }
    });

  program
    .command('mcp')
    .description('启动 MCP stdio server（默认代理到常驻 REST 服务）')
    .option('--local', '强制本地 App（不代理；会独占浏览器 profile）')
    .option('--proxy', '强制代理到 REST 服务（需要 BOSS_CLIENT_URL）')
    .option('--url <url>', 'REST 服务地址，如 http://127.0.0.1:8790')
    .action(async (opts: { local?: boolean; proxy?: boolean; url?: string }) => {
      try {
        const mode = opts.local ? 'local' : opts.proxy ? 'remote' : 'auto';
        const backend = await createBackend({ mode, ...(opts.url ? { url: opts.url } : {}) });
        const { startMcpServer } = await import('../mcp/server.js');
        await startMcpServer(backend);
        const shutdown = async () => {
          await backend.close().catch(() => {});
          process.exit(0);
        };
        process.once('SIGINT', () => void shutdown());
        process.once('SIGTERM', () => void shutdown());
        await new Promise(() => {});
      } catch (err) {
        printError(err);
      }
    });

  program
    .command('docs')
    .argument('[operationId]')
    .description('操作索引/单操作说明')
    .action(async (operationId?: string) => {
      const { OPERATIONS, getOperation } = await import('../../api/operations.js');
      if (!operationId) {
        for (const o of OPERATIONS) console.log(`${o.id}\t${o.rest.method} ${o.rest.path}\t${o.cli.command}\t${o.mcp.name}\t${o.summary}`);
        return;
      }
      try {
        console.log(JSON.stringify(getOperation(operationId), null, 2));
      } catch (err) {
        printError(err);
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

export { buildProgram };
