/**
 * 生成 spec/：
 *  - openapi.json
 *  - mcp-tools.json
 *  - cli-commands.json
 *  - schemas/*.json
 *  - operations/<id>.json
 *
 * npm run gen / npm run gen:check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { OPERATIONS, cliCommands, mcpTools } from '../api/operations.js';
import { ApiErrorSchema, ResponseMetaSchema, envelopeSchemaFor, SCHEMA_VERSION } from '../schemas/envelope.js';
import { JobSummarySchema, JobDetailSchema } from '../domain/job.js';
import { CompanySummarySchema, CompanyDetailSchema, CompanyJobSchema } from '../domain/company.js';
import {
  CompaniesListResponseSchema,
  JobsListResponseSchema,
  SearchJobsRequestSchema,
  SearchJobsResponseSchema,
  SearchQuerySchema,
} from '../domain/search.js';
import { LoginSessionSchema, LoginStartRequestSchema, LoginCaptchaRequestSchema } from '../domain/login.js';
import { HealthResponseSchema, StatusSchema } from '../domain/status.js';
import { CacheClearResultSchema, CacheStatsSchema } from '../domain/cache.js';
import { toJsonSchema, type JsonSchema } from './json-schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = path.join(ROOT, 'spec');

const MODELS: Record<string, z.ZodTypeAny> = {
  JobSummary: JobSummarySchema,
  JobDetail: JobDetailSchema,
  CompanySummary: CompanySummarySchema,
  CompanyDetail: CompanyDetailSchema,
  CompanyJob: CompanyJobSchema,
  SearchQuery: SearchQuerySchema,
  SearchJobsRequest: SearchJobsRequestSchema,
  SearchJobsResponse: SearchJobsResponseSchema,
  JobsListResponse: JobsListResponseSchema,
  CompaniesListResponse: CompaniesListResponseSchema,
  LoginStartRequest: LoginStartRequestSchema,
  LoginCaptchaRequest: LoginCaptchaRequestSchema,
  LoginSession: LoginSessionSchema,
  HealthResponse: HealthResponseSchema,
  Status: StatusSchema,
  CacheStats: CacheStatsSchema,
  CacheClearResult: CacheClearResultSchema,
};

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function buildOpenApi(): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const entry: Record<string, unknown> = {
      operationId: op.id,
      summary: op.summary,
      security: op.auth === 'bearer' ? [{ bearerAuth: [] }] : [],
      responses: {
        200: {
          description: '统一 envelope',
          content: { 'application/json': { schema: toJsonSchema(envelopeSchemaFor(op.output, `${op.id.replace(/[^a-zA-Z0-9]/g, '_')}_Envelope`), 'output') } },
        },
        default: {
          description: '错误 envelope',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { ok: { const: false }, data: { type: 'null' }, meta: toJsonSchema(ResponseMetaSchema, 'output'), error: toJsonSchema(ApiErrorSchema, 'output') },
                required: ['ok', 'data', 'meta', 'error'],
              },
            },
          },
        },
      },
    };
    const parameters: unknown[] = [];
    const names = [...op.rest.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
    for (const name of names) parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    if (op.rest.query) {
      const qs = toJsonSchema(op.rest.query, 'input') as JsonSchema;
      const props = (qs.properties ?? {}) as Record<string, JsonSchema>;
      const required = Array.isArray(qs.required) ? (qs.required as string[]) : [];
      for (const [name, schema] of Object.entries(props)) parameters.push({ name, in: 'query', required: required.includes(name), schema });
    }
    if (parameters.length) entry.parameters = parameters;
    if (op.rest.body) {
      entry.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(op.rest.body, 'input') } },
      };
    }
    paths[op.rest.path] = { ...(paths[op.rest.path] ?? {}), [op.rest.method.toLowerCase()]: entry };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'boss-client API', version: '0.1.0', description: 'BOSS直聘本地只读客户端 REST API' },
    servers: [{ url: 'http://127.0.0.1:8788' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths,
  };
}

function buildMcpTools(): unknown {
  return {
    schemaVersion: SCHEMA_VERSION,
    tools: mcpTools().map((t) => ({ name: t.name, description: t.description, operationId: t.operationId, inputSchema: toJsonSchema(t.input, 'input') })),
  };
}

function buildCliCommands(): unknown {
  return { schemaVersion: SCHEMA_VERSION, commands: cliCommands() };
}

function buildSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(MODELS)) out[name] = toJsonSchema(schema, 'output');
  return out;
}

function buildOperationSpecs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const op of OPERATIONS) {
    out[op.id] = {
      operationId: op.id,
      summary: op.summary,
      auth: op.auth,
      rest: op.rest,
      cli: op.cli,
      mcp: op.mcp,
      input: toJsonSchema(op.input, 'input'),
      output: toJsonSchema(op.output, 'output'),
    };
  }
  return out;
}

function buildAll(): Map<string, string> {
  const files = new Map<string, string>();
  files.set(path.join(SPEC, 'openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
  files.set(path.join(SPEC, 'mcp-tools.json'), JSON.stringify(buildMcpTools(), null, 2) + '\n');
  files.set(path.join(SPEC, 'cli-commands.json'), JSON.stringify(buildCliCommands(), null, 2) + '\n');
  for (const [name, schema] of Object.entries(buildSchemas())) {
    files.set(path.join(SPEC, 'schemas', `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
  }
  for (const [id, spec] of Object.entries(buildOperationSpecs())) {
    files.set(path.join(SPEC, 'operations', `${id}.json`), JSON.stringify(spec, null, 2) + '\n');
  }
  return files;
}

function main(): void {
  const check = process.argv.includes('--check');
  const files = buildAll();
  let drift = 0;
  for (const [file, content] of files) {
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
        console.error(`[gen] drift: ${path.relative(ROOT, file)}`);
        drift++;
      }
    } else {
      writeJson(file, JSON.parse(content));
    }
  }
  if (check) {
    if (drift) {
      console.error(`[gen] ${drift} file(s) out of date; run npm run gen`);
      process.exit(1);
    }
    console.error('[gen] spec is up to date');
    return;
  }
  console.error(`[gen] wrote ${files.size} spec files`);
}

main();
