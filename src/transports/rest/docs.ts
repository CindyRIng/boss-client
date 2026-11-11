/**
 * REST 文档端点：/docs、/openapi.json、/mcp-tools.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS } from '../../api/operations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function readOpenApiJson(): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'openapi.json'), 'utf8'));
}

export function readMcpToolsJson(): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'mcp-tools.json'), 'utf8'));
}

export function docsJsonResponse(): unknown {
  return {
    service: 'boss-client',
    operations: OPERATIONS.map((o) => ({
      id: o.id,
      summary: o.summary,
      auth: o.auth,
      rest: o.rest,
      cli: o.cli,
      mcp: o.mcp,
    })),
  };
}

export function renderDocsHtml(): string {
  const rows = OPERATIONS.map(
    (o) => `<tr><td><code>${o.id}</code></td><td>${o.summary}</td><td><code>${o.rest.method} ${o.rest.path}</code></td><td><code>${o.cli.command}</code></td><td><code>${o.mcp.name}</code></td></tr>`,
  ).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>boss-client API</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:32px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}code{background:#f3f4f6;padding:1px 4px;border-radius:4px}</style>
</head><body>
<h1>boss-client API</h1>
<p>本地只读 BOSS 直聘客户端。REST 仅监听 127.0.0.1，除 <code>/v1/health</code> 外需要 <code>Authorization: Bearer &lt;token&gt;</code>。</p>
<table><thead><tr><th>Operation</th><th>说明</th><th>REST</th><th>CLI</th><th>MCP</th></tr></thead><tbody>
${rows}
</tbody></table>
<p>机器可读：<a href="/openapi.json">/openapi.json</a> · <a href="/mcp-tools.json">/mcp-tools.json</a> · <a href="/docs?format=json">/docs?format=json</a></p>
</body></html>`;
}
