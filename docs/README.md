# boss-client 文档索引

| 文档 | 内容 |
| --- | --- |
| [00-需求访谈记录](./00-需求访谈记录.md) | Round 1 范围、Round 2 实测结论、Round 3 决策 |
| [01-需求文档](./01-需求文档.md) | PRD v0.1：目标/非目标、架构、功能需求、缓存、里程碑、验收、风险 |
| [02-接口草案](./02-接口草案.md) | envelope、错误码、数据模型、操作契约、CLI/REST/MCP、配置、SQLite schema |
| [03-部署与使用](./03-部署与使用.md) | 安装、配置、登录、CLI/REST/MCP 用法、systemd、排障 |
| [04-环境配套](./04-环境配套.md) | cloak-env/FHS、版本、profile、DISPLAY/Xvfb、权限、升级 |
| [2026-11-11 实测记录](../exploration/2026-11-11/REPORT.md) | 真实登录/搜索/详情/公司页实测与证据索引 |

代码与接口的单一事实源是 `src/domain/*.ts` + `src/api/operations.ts`；`spec/` 是 `npm run gen` 生成物。
