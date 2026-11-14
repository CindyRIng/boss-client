/**
 * REST 交互文档（/docs）、文档 JSON（/docs?format=json）与 spec 读取
 * 自包含 HTML，不依赖外部 CDN；内容由 operations 注册表实时生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, type OperationDef } from '../../api/operations.js';
import { ERROR_CATALOG } from '../../errors/catalog.js';
import { toJsonSchema, type JsonSchema } from '../../generators/json-schema.js';
import { VERSION } from '../../service.js';
import { SCHEMA_VERSION } from '../../schemas/envelope.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = process.env.BOSS_PORT ?? '8790';
const SERVER = `http://127.0.0.1:${PORT}`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(v: unknown, indent = 2): string {
  return esc(JSON.stringify(v, null, indent));
}

function typeOf(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop() ?? 'ref';
  if (Array.isArray(schema.enum)) return `enum(${(schema.enum as unknown[]).map(String).join(' | ')})`;
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as JsonSchema[]).map(typeOf).join(' | ');
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).map(typeOf).join(' | ');
  if (schema.type === 'array') return `array&lt;${typeOf(schema.items as JsonSchema)}&gt;`;
  return esc(String(schema.type ?? 'object'));
}

interface Row {
  name: string;
  in: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: unknown;
}

function rowsOf(op: OperationDef): Row[] {
  const out: Row[] = [];
  const add = (schema: unknown, where: string): void => {
    if (!schema) return;
    const j = toJsonSchema(schema as never) as JsonSchema;
    const required = (j.required as string[]) ?? [];
    for (const [name, s] of Object.entries((j.properties as Record<string, JsonSchema>) ?? {})) {
      out.push({
        name,
        in: where,
        type: typeOf(s),
        required: required.includes(name),
        description: (s.description as string | undefined) ?? '',
        ...(s.default !== undefined ? { defaultValue: s.default } : {}),
      });
    }
  };
  add(op.rest.pathParams, 'path');
  add(op.rest.query, 'query');
  add(op.rest.body, 'body');
  return out;
}

function exampleValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((schema.properties as Record<string, JsonSchema>) ?? {})) out[k] = exampleValue(v);
    return out;
  }
  return {};
}

function exampleBody(op: OperationDef): Record<string, unknown> {
  if (!op.rest.body) return {};
  const j = toJsonSchema(op.rest.body, 'input') as JsonSchema;
  return exampleValue(j) as Record<string, unknown>;
}

function curlExample(op: OperationDef): string {
  const headers: string[] = [];
  if (op.rest.body) headers.push("-H 'content-type: application/json'");
  if (op.auth === 'bearer') headers.push("-H 'Authorization: Bearer $BOSS_API_TOKEN'");
  const body = op.rest.body ? ` \\\n  -d '${JSON.stringify(exampleBody(op)).replace(/'/g, "'\\''")}'` : '';
  return `curl -sS -X ${op.rest.method} '${SERVER}${op.rest.path}'${headers.length ? ` \\\n  ${headers.join(' \\\n  ')}` : ''}${body}`;
}

function responseSchemaJson(op: OperationDef): string {
  try {
    return JSON.stringify(toJsonSchema(op.output, 'output'), null, 2);
  } catch {
    return '{}';
  }
}

const OPERATION_ERRORS: Record<string, string[]> = {
  'health.get': ['INTERNAL'],
  'status.get': ['UNAUTHORIZED', 'ALREADY_RUNNING', 'INTERNAL'],
  'session.login.start': ['UNAUTHORIZED', 'LOGIN_IN_PROGRESS', 'HEADFUL_REQUIRED', 'SMS_RATE_LIMITED', 'CAPTCHA_REQUIRED', 'INTERNAL'],
  'session.login.get': ['UNAUTHORIZED', 'LOGIN_EXPIRED', 'INTERNAL'],
  'session.login.captcha': ['UNAUTHORIZED', 'LOGIN_EXPIRED', 'CAPTCHA_INVALID', 'INTERNAL'],
  'session.login.sms': ['UNAUTHORIZED', 'LOGIN_EXPIRED', 'SMS_CODE_INVALID', 'CAPTCHA_REQUIRED', 'SMS_RATE_LIMITED', 'INTERNAL'],
  'session.login.cancel': ['UNAUTHORIZED', 'LOGIN_EXPIRED', 'INTERNAL'],
  'search.jobs': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'UPSTREAM_BLOCKED', 'UPSTREAM_CHANGED', 'RATE_LIMITED', 'TIMEOUT', 'INTERNAL'],
  'jobs.list': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'QUERY_EXPIRED', 'UPSTREAM_BLOCKED', 'RATE_LIMITED', 'INTERNAL'],
  'jobs.detail': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'NOT_FOUND', 'UPSTREAM_BLOCKED', 'UPSTREAM_CHANGED', 'INTERNAL'],
  'companies.list': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'QUERY_EXPIRED', 'UPSTREAM_BLOCKED', 'RATE_LIMITED', 'INTERNAL'],
  'companies.detail': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'NOT_FOUND', 'UPSTREAM_BLOCKED', 'UPSTREAM_CHANGED', 'INTERNAL'],
  'companies.jobs': ['UNAUTHORIZED', 'AUTH_REQUIRED', 'NOT_FOUND', 'UPSTREAM_BLOCKED', 'INTERNAL'],
  'cities.list': ['UNAUTHORIZED', 'UPSTREAM_UNAVAILABLE', 'INTERNAL'],
  'cache.stats': ['UNAUTHORIZED', 'CACHE_ERROR', 'INTERNAL'],
  'cache.clear': ['UNAUTHORIZED', 'CACHE_ERROR', 'INTERNAL'],
};

function errorsOf(op: OperationDef): string[] {
  return OPERATION_ERRORS[op.id] ?? ['UNAUTHORIZED', 'INTERNAL'];
}

function docsJson(): unknown {
  return {
    schemaVersion: SCHEMA_VERSION,
    clientVersion: VERSION,
    server: SERVER,
    auth: {
      type: 'bearer',
      scheme: 'Bearer',
      header: 'Authorization',
      note: '除 /v1/health 与文档端点外，所有 REST 请求都需要 Bearer token（BOSS_API_TOKEN）',
    },
    envelope: {
      success: {
        ok: true,
        data: {},
        meta: {
          schemaVersion: SCHEMA_VERSION,
          requestId: 'req_...',
          timestamp: '2026-11-11T12:00:00.000+08:00',
          tookMs: 0,
          cached: false,
          warnings: [],
        },
        error: null,
      },
      failure: {
        ok: false,
        data: null,
        meta: {
          schemaVersion: SCHEMA_VERSION,
          requestId: 'req_...',
          timestamp: '2026-11-11T12:00:00.000+08:00',
          tookMs: 0,
          cached: false,
          warnings: [],
        },
        error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
      },
    },
    operations: OPERATIONS.map((op) => ({
      id: op.id,
      summary: op.summary,
      auth: op.auth,
      rest: {
        method: op.rest.method,
        path: op.rest.path,
        pathParams: op.rest.pathParams ? toJsonSchema(op.rest.pathParams, 'input') : null,
        query: op.rest.query ? toJsonSchema(op.rest.query, 'input') : null,
        body: op.rest.body ? toJsonSchema(op.rest.body, 'input') : null,
      },
      requestFields: rowsOf(op),
      responseSchema: toJsonSchema(op.output, 'output'),
      cli: op.cli,
      mcp: op.mcp,
      errors: errorsOf(op),
    })),
    errorCatalog: Object.entries(ERROR_CATALOG).map(([code, meta]) => ({ code, ...meta })),
    links: {
      openapi: '/openapi.json',
      docsJson: '/docs?format=json',
      mcpTools: '/mcp-tools.json',
      health: '/v1/health',
      repository: 'https://github.com/CindyRIng/boss-client',
    },
  };
}

function errorTable(): string {
  const rows = Object.entries(ERROR_CATALOG)
    .map(
      ([code, m]) =>
        `<tr><td><code>${code}</code></td><td>${m.http}</td><td>${m.retryable ? '是' : '否'}</td><td>${esc(m.description)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>code</th><th>HTTP</th><th>retryable</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function operationSection(op: OperationDef): string {
  const rows = rowsOf(op);
  const fields = rows.length
    ? `<table><thead><tr><th>字段</th><th>位置</th><th>类型</th><th>必填</th><th>说明</th><th>默认</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td><code>${esc(r.name)}</code></td><td>${r.in}</td><td><code>${r.type}</code></td><td>${r.required ? '是' : '否'}</td><td>${esc(r.description)}</td><td>${r.defaultValue !== undefined ? `<code>${esc(JSON.stringify(r.defaultValue))}</code>` : '—'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">无参数</p>';
  const errors = errorsOf(op).map((code) => `<code>${code}</code>`).join(' ');
  const auth = op.auth === 'bearer' ? 'Bearer token' : '无需鉴权';
  return `
  <section id="${esc(op.id)}" class="op">
    <h3><span class="method ${op.rest.method.toLowerCase()}">${op.rest.method}</span> <code>${esc(op.rest.path)}</code></h3>
    <p>${esc(op.summary)}</p>
    <p class="meta">操作 ID: <code>${esc(op.id)}</code> · 鉴权: ${auth} · MCP: <code>${esc(op.mcp.name)}</code> · CLI: <code>boss ${esc(op.cli.command)}</code></p>
    ${fields}
    <details><summary>响应 schema（data）</summary><pre>${json(toJsonSchema(op.output, 'output'))}</pre></details>
    <details><summary>cURL 示例</summary><pre>${esc(curlExample(op))}</pre></details>
    <p class="meta">可能错误: ${errors}</p>
  </section>`;
}

export function renderDocsHtml(): string {
  const nav = OPERATIONS.map(
    (op) => `<li><a href="#${esc(op.id)}"><span class="method ${op.rest.method.toLowerCase()}">${op.rest.method}</span> <code>${esc(op.rest.path)}</code></a></li>`,
  ).join('');
  const sections = OPERATIONS.map(operationSection).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>boss-client API ${SCHEMA_VERSION} · BOSS直聘本地客户端</title>
<style>
  :root { color-scheme: light; --ink:#15202b; --muted:#66788a; --line:#dbe4ef; --teal:#0f9d8a; --navy:#08131f; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin:0; font: 14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif; color:var(--ink); background:#f2f6fb; }
  header { position:sticky; top:0; z-index:20; color:#e9f7f3; background:radial-gradient(1100px 320px at 12% -20%,#145b5b 0,transparent 60%),linear-gradient(135deg,#07111c,#0a1c2c 55%,#0d2d35); border-bottom:1px solid rgba(130,230,214,.18); padding:18px 30px 14px; box-shadow:0 8px 30px rgba(7,17,28,.18); }
  header .brand { display:flex; align-items:center; gap:14px; }
  header .logo { width:42px; height:42px; border-radius:13px; display:grid; place-items:center; font:800 18px/1 ui-monospace,SFMono-Regular,Menlo,monospace; color:#04151a; background:linear-gradient(135deg,#67efd4,#b9f7e7); box-shadow:0 0 0 1px rgba(255,255,255,.25),0 10px 26px rgba(60,220,196,.25); }
  header h1 { margin:0; font-size:20px; letter-spacing:.2px; color:#fff; }
  header h1 span { color:#7dded0; font-weight:500; }
  header .subtitle { margin-top:2px; color:#9fb9b7; font-size:12px; }
  header .links { display:flex; gap:16px; flex-wrap:wrap; margin-top:10px; }
  header .links a { color:#8af0df; text-decoration:none; font-size:12px; border-bottom:1px dotted rgba(138,240,223,.35); }
  header .links a:hover { color:#fff; border-color:#fff; }
  header .stats { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  header .pill { border:1px solid rgba(140,240,222,.22); background:rgba(255,255,255,.06); color:#c9f4ec; border-radius:999px; padding:3px 9px; font-size:11px; }
  .layout { display:flex; align-items:flex-start; max-width:1480px; margin:0 auto; }
  nav { width:350px; flex:0 0 350px; overflow-x:hidden; position:sticky; top:132px; max-height:calc(100vh - 150px); overflow:auto; padding:22px 12px 22px 18px; }
  nav strong { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin:0 0 10px 6px; }
  nav ul { list-style:none; margin:0; padding:0; }
  nav li { margin:3px 0; }
  nav a { color:#203243; text-decoration:none; display:flex; align-items:flex-start; gap:8px; padding:5px 8px; border-radius:8px; font-size:12px; min-width:0; }
  nav a:hover { background:#e7f1f7; color:#075e56; }
  nav a code { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  main { flex:1; min-width:0; background:#fff; margin:22px 22px 48px 0; border:1px solid var(--line); border-radius:18px; padding:28px 34px 90px; box-shadow:0 18px 50px rgba(32,61,92,.08); }
  h2 { margin-top:26px; padding-bottom:8px; border-bottom:1px solid var(--line); font-size:21px; letter-spacing:.1px; }
  h2:first-child { margin-top:0; }
  h3 { margin:26px 0 8px; font-size:16px; }
  code { background:#eef4f9; padding:1px 5px; border-radius:5px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#17364a; }
  pre { background:#0b1723; color:#d6eee9; padding:14px 16px; border-radius:12px; overflow:auto; font-size:12px; line-height:1.55; border:1px solid #162b3b; }
  pre code { background:transparent; color:inherit; padding:0; }
  table { border-collapse:separate; border-spacing:0; width:100%; margin:10px 0 16px; font-size:13px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th,td { padding:8px 10px; text-align:left; vertical-align:top; border-bottom:1px solid var(--line); }
  tr:last-child td { border-bottom:none; }
  th { background:#f4f8fc; color:#3c5266; font-weight:600; white-space:nowrap; }
  tbody tr:nth-child(even) td { background:#fbfdff; }
  .muted { color:var(--muted); }
  .meta { font-size:12px; color:var(--muted); }
  .op { background:#fcfdff; border:1px solid var(--line); border-radius:14px; padding:16px 18px 14px; margin:18px 0; scroll-margin-top:142px; }
  .op h3 { margin:0 0 4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .op h3 code { background:#eaf2f8; font-size:12px; }
  .method { display:inline-block; min-width:52px; text-align:center; padding:2px 7px; border-radius:5px; color:#fff; font-size:11px; font-weight:700; letter-spacing:.02em; }
  .method.get { background:#168a5b; } .method.post { background:#1d6fd8; } .method.delete { background:#cf3341; } .method.put { background:#a87612; }
  .note { background:linear-gradient(90deg,#e7faf5,#f7fffc); border:1px solid #a9e6d9; border-left:4px solid #19a98f; border-radius:10px; padding:12px 15px; }
  details { margin:10px 0; border:1px solid #e3ebf3; border-radius:9px; padding:8px 11px; background:#fbfdff; }
  summary { cursor:pointer; color:#0b6f9f; font-size:12px; }
  details pre { margin:10px 0 2px; }
  @media (max-width: 980px) { header { padding:14px 18px; } header .stats { display:none; } nav { display:none; } main { margin:14px; padding:20px 18px 60px; } }
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="logo">B</div>
    <div>
      <h1>boss-client <span>API</span></h1>
      <div class="subtitle">BOSS直聘本地只读客户端 · v${VERSION} · schema ${SCHEMA_VERSION}</div>
    </div>
  </div>
  <div class="stats">
    <span class="pill">${OPERATIONS.length} operations</span>
    <span class="pill">127.0.0.1:${PORT}</span>
    <span class="pill">Bearer auth</span>
    <span class="pill">read-only</span>
  </div>
  <div class="links">
    <a href="/openapi.json">OpenAPI 3.1</a>
    <a href="/docs?format=json">文档 JSON</a>
    <a href="/mcp-tools.json">MCP tools</a>
    <a href="/v1/health">Health</a>
    <a href="https://github.com/CindyRIng/boss-client">GitHub</a>
  </div>
</header>
<div class="layout">
<nav><strong>操作（${OPERATIONS.length}）</strong><ul>${nav}</ul></nav>
<main>
  <h2>通用约定</h2>
  <p class="note">REST 仅监听 <code>127.0.0.1:${PORT}</code>；除 <code>/v1/health</code> 与文档页外，均需 <code>Authorization: Bearer &lt;BOSS_API_TOKEN&gt;</code>。所有响应为统一 envelope：<code>{ ok, data, meta, error }</code>，<code>meta.schemaVersion = "${SCHEMA_VERSION}"</code>；分页字段见 <code>meta.pagination</code>。只读，不提供沟通/投递/简历接口。</p>
  <p class="meta">本服务坐标：<code>${SERVER}</code> · 仓库：<code>https://github.com/CindyRIng/boss-client</code></p>
  <h3>鉴权</h3>
  <pre>Authorization: Bearer &lt;BOSS_API_TOKEN&gt;</pre>
  <h3>响应 envelope 示例</h3>
  <pre>${json({ ok: true, data: {}, meta: { schemaVersion: SCHEMA_VERSION, requestId: 'req_...', timestamp: '2026-11-11T12:00:00.000+08:00', tookMs: 0, cached: false, warnings: [] }, error: null })}</pre>
  <h3>错误码</h3>
  ${errorTable()}
  <h3>操作</h3>
  ${sections}
</main>
</div>
</body>
</html>`;
}

function readSpec(name: string): unknown {
  const candidates = [path.join(ROOT, 'spec', name), path.join(process.cwd(), 'spec', name)];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error(`spec/${name} not found; run \`npm run gen\``);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function readOpenApiJson(): unknown {
  return readSpec('openapi.json');
}

export function readMcpToolsJson(): unknown {
  return readSpec('mcp-tools.json');
}

export function docsJsonResponse(): unknown {
  return docsJson();
}
