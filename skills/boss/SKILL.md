# boss-client SKILL

## 描述

使用本机 `boss-client` 对 BOSS直聘做**只读**岗位/公司检索：搜岗位关键词 → 找到在招公司 → 看公司详情（含工商信息）/岗位详情 → 汇总线索。适合外贸/销售/招聘研究等场景。

## 何时使用

- 需要按「外贸 / 国际贸易 / 海外销售 / 单证 / 跟单」等关键词找正在招聘的公司。
- 需要公司工商信息（USCC/法人/注册资本/经营范围）和公司在招职位。
- 需要结构化 JSON 给下游 CRM/表格/agent 继续处理。

## 前置

- 本机已安装并构建 `boss-client`，`boss` 命令可用（或使用 MCP 工具）。
- 已登录（`boss status` 显示 `loggedIn=true`）；未登录时先 `boss login`（需人工扫/码/极验）。
- 只读：不要调用沟通/投递/简历/招聘者切换；本客户端不提供这些接口。

## 推荐流程

```bash
# 1) 体检
boss status

# 2) 搜岗位（城市码可用 boss cities list 查）
boss search jobs --keyword 外贸 --city 101090100 --page-size 15 --pages 1
# 输出 data.query.queryId、data.jobs、data.companies

# 3) （可选）翻更多页后重新聚合公司
boss jobs list --query-id <queryId> --page 2
boss companies list --query-id <queryId> --fetch-pages 1

# 4) 看公司（含工商）
boss companies detail --id '<companyId>'

# 5) 看公司全部在招职位
boss companies jobs --id '<companyId>'

# 6) 看岗位详情
boss jobs detail --job-id '<jobId>'
```

## MCP 工具

`boss_health`、`boss_status`、`boss_login_start/status/captcha_solve/sms_verify/cancel`、`boss_search_jobs`、`boss_list_jobs`、`boss_job_detail`、`boss_list_companies`、`boss_company_detail`、`boss_company_jobs`、`boss_cities`、`boss_cache_stats`、`boss_cache_clear`。

参数与 CLI 同名；返回值是统一 envelope（`ok/data/meta/error`）。

## 输出组织建议

对每家公司汇总：

```json
{
  "companyId": "...",
  "name": "...",
  "industry": "...",
  "scale": "...",
  "stage": "...",
  "city": "...",
  "jobCount": 2,
  "matchedJobs": [{"title": "...", "salaryText": "...", "url": "..."}],
  "business": {"uscc": "...", "legalRepresentative": "...", "registeredCapital": "..."}
}
```

## 约束

- 单次搜索 ≤5 页；不要并发；页间已由服务端延迟。
- 同一条件 2h 缓存；需要最新数据用 `--refresh` / `refresh=true`。
- 遇 `UPSTREAM_BLOCKED`（code37）停止并等 `status.risk.cooldownUntil`；不要重试轰炸。
- 遇 `AUTH_REQUIRED` / `SESSION_EXPIRED`：提示用户 `boss login`，不要尝试自动破解极验。
- 遇 `HEADFUL_REQUIRED`：需要显示环境（桌面或 Xvfb）。
- 只在本人/授权账号上使用；遵守 BOSS直聘服务条款。

## 错误处理

| 错误 | 建议 |
| --- | --- |
| `AUTH_REQUIRED` / `SESSION_EXPIRED` | 人工重新登录 |
| `CAPTCHA_REQUIRED` / `CAPTCHA_INVALID` | 用 REST 中继展示 captcha；人工/agent 提交坐标或滑块 |
| `SMS_CODE_INVALID` | 重新输入短信码 |
| `UPSTREAM_BLOCKED` | 冷却后重试；降低频率 |
| `RATE_LIMITED` | 按 `retryAfterMs` 退避 |
| `QUERY_EXPIRED` | 重新 `search jobs` |
| `NOT_FOUND` | 公司/岗位可能下架，重新搜索 |
