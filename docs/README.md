<div align="center">
  <img src="assets/hero.jpg" alt="boss-client" width="100%" />
  <h1>boss-client 文档</h1>
  <p>从「它是什么」到「部署、登录、接入 Agent」的完整路径。</p>
</div>

> 代码与接口的单一事实源是 `src/domain/*.ts` + `src/api/operations.ts`；`spec/` 是 `npm run gen` 生成物。文档按 v0.1 编写，行为以当前代码与 `boss --help` / `/docs` 为准。

## 推荐阅读顺序

| 步骤 | 文档 | 你会得到 |
| --- | --- | --- |
| 1 | [README](../README.md) | 项目定位、30 秒开始、架构与安全边界 |
| 2 | [03 部署与使用](./03-部署与使用.md) | 安装、配置、登录、CLI/REST/MCP、systemd、排障 |
| 3 | [04 环境配套](./04-环境配套.md) | cloak-env/FHS、profile、DISPLAY/Xvfb、权限与版本 |
| 4 | [02 接口草案](./02-接口草案.md) | envelope、错误码、数据模型、操作契约、SQLite |
| 5 | [01 需求文档](./01-需求文档.md) | 目标/非目标、功能需求、缓存、验收与风险 |
| 参考 | [00 需求访谈记录](./00-需求访谈记录.md) | 需求如何一步步收敛到当前实现 |
| 实测 | [2026-11-11 实测记录](../exploration/2026-11-11/REPORT.md) | 真实登录/搜索/详情/公司页的证据索引 |

## 三种使用姿势

| 你是 | 先看 | 直接命令 |
| --- | --- | --- |
| 想先跑起来 | [快速开始](../README.md#30-秒开始) | `boss login --qr` → `boss status` |
| 要接业务系统 | [REST 文档](./03-部署与使用.md#52-rest) | `GET /docs` · `GET /openapi.json` |
| 要接 Agent | [MCP 文档](./03-部署与使用.md#53-mcp默认代理到常驻服务) | `boss mcp` + `BOSS_CLIENT_URL` |
| 要运维/排障 | [排障表](./03-部署与使用.md#7-观测与排障) | `systemctl --user status boss-client` |

## 文档地图

```text
docs/
├── 00-需求访谈记录.md   需求是怎么定下来的
├── 01-需求文档.md       PRD：做什么、不做什么、怎么验收
├── 02-接口草案.md       API 契约：envelope / 错误码 / 数据模型
├── 03-部署与使用.md     从安装到 systemd 再到排障
├── 04-环境配套.md       cloak-env / FHS / profile / DISPLAY
├── README.md            本页
└── assets/              README 图片、REST 文档截图
```

## 关键约定（先记住这三条）

1. **只读**：不沟通、不投递、不改简历、不切换招聘者身份。
2. **一个 owner**：常驻服务持有浏览器/profile；CLI/MCP 是客户端，默认走 REST。
3. **结构化缓存**：只缓存解析后的数据，不落 raw 响应/HTML，不存 Cookie/token/验证码。

## 图片素材

- `assets/hero.jpg`、`assets/workflow.jpg`：MiniMax H3 Image 生成，无文字/Logo。
- `assets/rest-docs.png`：`/docs` 实际页面顶部截图。
- `assets/rest-docs-operation.png`：`/docs` 操作详情截图（字段表 / 响应 schema / 错误码）。
- 生成与截图说明见 [`assets/README.md`](./assets/README.md)。

图片只用于说明产品形态与架构关系，不包含真实账号、Cookie 或业务数据。
