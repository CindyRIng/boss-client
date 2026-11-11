/**
 * MCP 传输层（stdio）
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getOperation, mcpTools } from '../../api/operations.js';
import { invoke, type InvocationInput } from '../../api/dispatch.js';
import { asBossError } from '../../errors/catalog.js';
import { failureEnvelope, successEnvelope } from '../../schemas/envelope.js';
import type { App } from '../../app.js';
import { toJsonSchema } from '../../generators/json-schema.js';

const TOOL_MAP = new Map(mcpTools().map((t) => [t.name, t]));

function argsToInvocation(operationId: string, args: Record<string, unknown>): InvocationInput {
  switch (operationId) {
    case 'session.login.get':
    case 'session.login.cancel':
      return { pathParams: { loginId: String(args.loginId ?? '') } };
    case 'session.login.captcha': {
      const { loginId, ...rest } = args;
      return { pathParams: { loginId: String(loginId ?? '') }, body: rest };
    }
    case 'session.login.sms': {
      const { loginId, ...rest } = args;
      return { pathParams: { loginId: String(loginId ?? '') }, body: rest };
    }
    case 'session.login.start':
    case 'search.jobs':
      return { body: args };
    case 'jobs.detail': {
      const { jobId, ...rest } = args;
      return { pathParams: { jobId: String(jobId ?? '') }, query: rest };
    }
    case 'companies.detail':
    case 'companies.jobs': {
      const { companyId, ...rest } = args;
      return { pathParams: { companyId: String(companyId ?? '') }, query: rest };
    }
    case 'jobs.list':
    case 'companies.list':
    case 'cities.list':
    case 'cache.clear':
      return { query: args };
    default:
      return {};
  }
}

export function createMcpServer(app: App): Server {
  const server = new Server({ name: 'boss-client', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools().map((t) => ({ name: t.name, description: t.description, inputSchema: toJsonSchema(t.input) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_MAP.get(request.params.name);
    const rid = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(failureEnvelope({ code: 'NOT_FOUND', message: `unknown tool: ${request.params.name}`, retryable: false }, { requestId: rid, tookMs: 0 })) }],
      };
    }
    try {
      const parsed = tool.input.safeParse(request.params.arguments ?? {});
      if (!parsed.success) throw parsed.error;
      getOperation(tool.operationId);
      const result = await invoke(app.service, tool.operationId, argsToInvocation(tool.operationId, parsed.data as Record<string, unknown>));
      const envelope = successEnvelope(result.data, {
        requestId: rid,
        tookMs: Date.now() - started,
        cached: result.cached ?? false,
        ...(result.pagination ? { pagination: result.pagination } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
    } catch (err) {
      const e = asBossError(err);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(failureEnvelope(e.toJSON(), { requestId: rid, tookMs: Date.now() - started })) }],
      };
    }
  });
  return server;
}

export async function startMcpServer(app: App): Promise<void> {
  const server = createMcpServer(app);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] boss-client MCP server started (stdio)');
}
