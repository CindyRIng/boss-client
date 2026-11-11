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

const PATH_PARAM_DESC: Record<string, string> = {
  loginId: '登录流程 ID（login_*）',
  jobId: 'encryptJobId，用于 /job_detail/<id>.html',
  companyId: 'encryptBrandId，用于 /gongsi/<id>.html',
};

const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  data: z.null(),
  meta: ResponseMetaSchema,
  error: ApiErrorSchema,
});

class SchemaRegistry {
  readonly defs: Record<string, JsonSchema> = {};

  normalize(schema: JsonSchema): JsonSchema {
    const clone = JSON.parse(JSON.stringify(schema)) as JsonSchema;
    this.extract(clone);
    this.rewrite(clone);
    return clone;
  }

  private extract(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) this.extract(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.$defs && typeof obj.$defs === 'object') {
      for (const [name, def] of Object.entries(obj.$defs as Record<string, JsonSchema>)) {
        this.defs[name] = this.normalize(def);
      }
      delete obj.$defs;
    }
    for (const value of Object.values(obj)) this.extract(value);
  }

  private rewrite(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) this.rewrite(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/$defs/')) {
      obj.$ref = `#/components/schemas/${obj.$ref.slice('#/$defs/'.length)}`;
    }
    for (const value of Object.values(obj)) this.rewrite(value);
  }
}

function errorResponse(description: string): unknown {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
  };
}

function buildOpenApi(): unknown {
  const registry = new SchemaRegistry();
  const errorEnvelope = registry.normalize(toJsonSchema(ErrorEnvelopeSchema, 'output'));
  registry.defs.ErrorEnvelope = errorEnvelope;

  const tags = [
    { name: 'health', description: '健康检查' },
    { name: 'status', description: '状态 / 会话 / 风控 / 缓存' },
    { name: 'session', description: '登录中继（QR/短信/极验）' },
    { name: 'search', description: '岗位搜索' },
    { name: 'jobs', description: '岗位列表/详情' },
    { name: 'companies', description: '公司列表/详情/职位' },
    { name: 'cities', description: '城市注册表' },
    { name: 'cache', description: '缓存管理' },
  ];

  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const envelope = registry.normalize(
      toJsonSchema(envelopeSchemaFor(op.output, `${op.id.replace(/[^a-zA-Z0-9]/g, '_')}_Envelope`), 'output'),
    );
    const entry: Record<string, unknown> = {
      operationId: op.id,
      summary: op.summary,
      tags: [op.id.split('.')[0]],
      security: op.auth === 'bearer' ? [{ bearerAuth: [] }] : [],
      responses: {
        200: {
          description: '统一 envelope（成功）',
          content: { 'application/json': { schema: envelope } },
        },
        400: errorResponse('参数/校验错误'),
        401: errorResponse('未授权或需要登录'),
        403: errorResponse('无权限/风控拒绝'),
        404: errorResponse('资源不存在'),
        409: errorResponse('状态冲突/登录流程冲突'),
        429: errorResponse('限频'),
        500: errorResponse('内部错误'),
        502: errorResponse('上游改版/风控拦截'),
        503: errorResponse('上游不可用'),
        504: errorResponse('上游超时'),
      },
    };

    const parameters: unknown[] = [];
    const names = [...op.rest.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
    let pathProps: Record<string, JsonSchema> = {};
    if (op.rest.pathParams) {
      const ps = registry.normalize(toJsonSchema(op.rest.pathParams, 'input'));
      pathProps = (ps.properties ?? {}) as Record<string, JsonSchema>;
    }
    for (const name of names) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        ...(PATH_PARAM_DESC[name] ? { description: PATH_PARAM_DESC[name] } : {}),
        schema: pathProps[name] ?? { type: 'string' },
      });
    }
    if (op.rest.query) {
      const qs = registry.normalize(toJsonSchema(op.rest.query, 'input'));
      const props = (qs.properties ?? {}) as Record<string, JsonSchema>;
      const required = Array.isArray(qs.required) ? (qs.required as string[]) : [];
      for (const [name, schema] of Object.entries(props)) {
        parameters.push({ name, in: 'query', required: required.includes(name), schema });
      }
    }
    if (parameters.length) entry.parameters = parameters;
    if (op.rest.body) {
      entry.requestBody = {
        required: true,
        content: { 'application/json': { schema: registry.normalize(toJsonSchema(op.rest.body, 'input')) } },
      };
    }
    paths[op.rest.path] = { ...(paths[op.rest.path] ?? {}), [op.rest.method.toLowerCase()]: entry };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'boss-client API',
      version: '0.1.0',
      description: 'BOSS直聘本地只读客户端 REST API：岗位搜索、岗位详情、公司列表、公司详情（含工商信息）、公司全部职位、状态与登录中继。',
      license: { name: 'MIT', url: 'https://github.com/CindyRIng/boss-client/blob/main/LICENSE' },
    },
    servers: [{ url: `http://127.0.0.1:${process.env.BOSS_PORT ?? '8790'}` }],
    tags,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Bearer token（BOSS_API_TOKEN）；除 /v1/health 外均需',
        },
      },
      schemas: registry.defs,
    },
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
