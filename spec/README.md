# spec 目录

由 `npm run gen` 从 `src/domain` + `src/api/operations.ts` 生成，不要手改。

- `openapi.json`：OpenAPI 3.1
- `mcp-tools.json`：MCP 工具清单与 inputSchema
- `cli-commands.json`：CLI 命令清单
- `schemas/`：领域模型 JSON Schema
- `operations/`：每个操作的输入/输出 schema

`npm run gen:check` 用于 CI 检查是否与代码一致。
