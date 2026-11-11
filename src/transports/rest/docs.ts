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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif; color:#1f2328; background:#fff; }
  header { position:sticky; top:0; background:#fff; border-bottom:1px solid #d0d7de; padding:14px 24px; z-index:10; }
  header h1 { font-size:18px; margin:0 0 4px; }
  header .links a { margin-right:14px; color:#0969da; text-decoration:none; }
  .layout { display:flex; align-items:flex-start; }
  nav { width:340px; flex:0 0 340px; position:sticky; top:70px; max-height:calc(100vh - 70px); overflow:auto; border-right:1px solid #d0d7de; padding:14px 12px; }
  nav ul { list-style:none; margin:0; padding:0; }
  nav li { margin:4px 0; }
  nav a { color:#1f2328; text-decoration:none; display:block; padding:4px 6px; border-radius:6px; font-size:12px; }
  nav a:hover { background:#f6f8fa; }
  main { flex:1; padding:18px 28px 80px; max-width:1100px; }
  h2 { margin-top:28px; border-bottom:1px solid #d0d7de; padding-bottom:6px; }
  h3 { margin:22px 0 6px; }
  code { background:#f6f8fa; padding:1px 5px; border-radius:4px; font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  pre { background:#f6f8fa; padding:12px; border-radius:8px; overflow:auto; font-size:12px; }
  table { border-collapse:collapse; width:100%; margin:8px 0 14px; font-size:13px; }
  th,td { border:1px solid #d0d7de; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f6f8fa; }
  .muted { color:#59636e; }
  .meta { font-size:12px; color:#59636e; }
  .op { border-top:1px dashed #d0d7de; padding-top:8px; }
  .method { display:inline-block; min-width:52px; text-align:center; padding:1px 6px; border-radius:4px; color:#fff; font-size:11px; font-weight:600; }
  .method.get { background:#1a7f37; } .method.post { background:#0969da; } .method.delete { background:#cf222e; } .method.put { background:#9a6700; }
  .note { background:#fff8c5; border:1px solid #d4a72c; border-radius:8px; padding:10px 14px; }
  details { margin:8px 0; }
  summary { cursor:pointer; color:#0969da; }
</style>
</head>
<body>
<header>
  <h1>boss-client API <span class="muted">v${VERSION} · schema ${SCHEMA_VERSION}</span></h1>
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
