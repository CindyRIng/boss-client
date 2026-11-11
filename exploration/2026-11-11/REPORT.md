# BOSS 直聘实测记录（2026-11-11）

> 目的：在写 PRD / 接口草案之前，用非无头 cloakbrowser 真实走一遍 BOSS 直聘的登录与只读链路，记录页面浏览顺序、全部 document/XHR/fetch 请求与关键响应字段。
>
> 账号：本人求职者账号（手机号已脱敏；`isHunter=false`，`studentFlag=true`）。
> 浏览器：cloakbrowser 0.6.5 + Chromium 146，headful，`humanize=true`，独立 profile `~/.boss-client/profile`。
> 运行方式：`~/cloak-env/bin/cloak-run node exploration/2026-11-11/controller.mjs`（Node 22.23.2，DISPLAY=:0）。

---

## 1. 产物体量

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| 请求/响应事件 | `artifacts/network.jsonl` | 942 行；document/xhr/fetch 的 request/response/requestfailed |
| 页面导航顺序 | `artifacts/navigations.jsonl` | 61 行；`framenavigated` / `domcontentloaded` / `load` |
| 操作时间线 | `artifacts/actions.jsonl` | 66 行；命令开始/结束、页面 attach、pageerror |
| 响应体归档 | `artifacts/responses.jsonl` + `artifacts/responses/` | 419 条索引、388 个文件；按 URL/状态/SHA-256 记录 |
| 页面截图 | `artifacts/screenshots/` | 27 张关键态截图 |
| 登录 QR 原图 | `artifacts/qr.png` | 200×200，3136 bytes；来自 `.qr-code-box img` 的 blob URL |
| 登录结果 | `artifacts/login-result.json` / `sms-send.json` | 成功；含脱敏后的页面文本 |
| 状态样本 | `artifacts/status-*.json` | `getUserInfo` / `account/getStatus` / `vip/info` |
| cookie 摘要 | `artifacts/cookies-*.json` | 仅 name/domain/expires，不含 value |

> 注意：`artifacts/` 内包含登录态相关数据，全部落 0600/0700；不要把 `responses/`、`qr.png`、`storage-state.json`、`cookies-*.json` 提交到仓库或贴到聊天里。

---

## 2. 登录实测

### 2.1 两种方式

- **二维码**：登录页默认/可切到「APP扫码登录」，二维码是 `.qr-code-box` 内一个 `<img src="blob:...">`（200×200）。在页面内 `fetch(blobUrl)` 可拿到 PNG 字节，实测 3136 bytes。REST 可直接 Base64 返回，CLI 可渲染到终端。
- **短信验证码（默认）**：手机号输入框 `input[type=tel]` + “发送验证码”。点击前会先弹 **极验（geetest v3）** 验证码，解决后才真正调用 `POST /wapi/zppassport/send/smsCodeV2`，短信到达后提交 6 位码完成登录。

### 2.2 验证码类型（两种都遇到了）

| 类型 | 页面文案 | DOM | 实测 |
| --- | --- | --- | --- |
| 点选 | `请在下图依次点击：` | `.geetest_canvas_bg` / `.geetest_canvas_slice` / `.geetest_tip_img` / `.geetest_commit` | 按提示图标顺序点击主图，再点「确认」；本轮用该方式通过 |
| 滑块 | `拖动滑块完成拼图` | `.geetest_slider_button` / `.geetest_slider_track` / `.geetest_window` | 本轮未最终使用；可用 `page.mouse` 拖动（合成事件无效） |

> 关键结论：**验证码不能靠普通 HTTP 绕过**，也不能靠简单 DOM 拼接；必须让真实浏览器完成极验 challenge，或接入人工/视觉求解。客户端能做的是：
> 1) 打开 headful 浏览器让用户/代理完成验证；
> 2) 或把验证码截图 + 点击坐标通过 REST/CLI 暴露出去，由外部 agent/人求解。
>
> 本轮是 AI 通过截图识别点选图标位置后，用 Playwright 可信鼠标事件点击通过的；这条路径不适合作为生产环境的“全自动”默认，只适合人工介入/agent 辅助。

### 2.3 实测请求序列（登录）

```
GET  /web/user/                                  # 登录页 document
GET  /wapi/zppassport/smsSwitch                  # smsSwitch=true
POST /wapi/zppassport/captcha/randkey            # qrId / randKey / secretKey / shortRandKey
POST /wapi/zppassport/captcha/getTypeV2          # captchaType=1 极验；startCaptcha 内含 challenge/gt
POST /wapi/zppassport/send/smsCodeV2             # encryptedAccount/regionCode/pk/smsType=7/purpose=0/version=1/challenge/validate/seccode
POST /wapi/zppassport/validate/getLoginSuggest   # 提交短信码（token/encryptedAccount/code/regionCode）
POST /wapi/zppassport/login/phoneV2              # phoneCode + challenge/validate/seccode
POST /wapi/zppassport/set/zpToken                # 写登录 token
GET  /wapi/zpuser/wap/getUserInfo.json           # code=0，userId 等
```

- 手机号在请求里是 `encryptedAccount`（不是明文）；短信码字段是 `code` / `phoneCode`。
- 扫码入口的请求：`/wapi/zppassport/qrcode/scan?uuid=...`、`/qrcode/getHeadImg`、`/qrcode/scanLogin`、`/qrcode/dispatcher` 等；页面自身在轮询，客户端只需展示 QR 并轮询登录态。
- 实测登录成功后页面跳转 `https://www.zhipin.com/`，再按 IP 重定向到 `/shijiazhuang/`。

### 2.4 会话持久化

- profile 持久化有效：关闭浏览器后重新启动 controller，直接 `already logged in (profile session reused)`，无需重新登录。
- 登录态 cookie（实测）：
  - `wt2` / `zp_at`：`HttpOnly`，到期约 **2026-11-22 03:00 +08**（约 10.6 天）；
  - `__zp_stoken__`：到期约 **2026-11-14 04:05 +08**（约 3 天，短周期风控 token，页面会续）；
  - `bst`：`Secure`，与登录态一起。
- 结论：**首次登录必须人工介入；之后 profile 复用 + 心跳即可长期在线**。会话失效后仍需人工重扫/重收码。PRD 里不能承诺“首次全自动登录”。

### 2.5 登录态检测

`GET /wapi/zpuser/wap/getUserInfo.json` 返回 `code=0` 且 `zpData.userId` 存在即已登录；实测 `zpData` 含：

`userId`、`identity`、`encryptUserId`、`name`、`showName`、`token`、`isHunter`、`clientIP`、`email`、`phone`、`brandName`、`doubleIdentity`、`recruit`、`studentFlag`、`complete` 等。

本轮账号：`userId` 9 位、`isHunter=false`、`studentFlag=true`、`complete=true`。`/wapi/zpuser/h5/account/getStatus` 返回安全设置（`deviceSecurity=true` 等）；`/wapi/zpitem/geek/vip/info` 返回会员信息。BOSS 求职者侧**没有探迹那种“额度”概念**，`status` 不应设计日/月额度字段。

---

## 3. 岗位搜索

### 3.1 页面与接口

- 页面：`https://www.zhipin.com/web/geek/jobs?query=<kw>&city=<cityCode>&industry=&position=`
- 列表 XHR：`POST /wapi/zpgeek/search/joblist.json?_=<ts>`
- 表单字段（实测）：

```
page=1
pageSize=15
city=101090100            # 石家庄；北京 101010100
query=外贸
expectInfo=
multiSubway=
multiBusinessDistrict=
position=
jobType=
salary=
experience=
degree=
industry=
scale=
stage=
scene=1
encryptExpectId=
```

- 响应：`{code:0, message, zpData:{resCount, filterString, lid, hasMore, jobList, totalCount, brandCard}}`
- 实测（北京/外贸）：`resCount=450`、`totalCount=300`（展示上限）、`hasMore=true`、`jobList=15`、`lid` 11 字符。
- 单页 15 条；滚动会触发更多 XHR（infinite scroll）。页面**没有传统分页按钮**；但接口 `page` 参数有效：直接请求 `page=2` 返回 15 条、`code=0`。
- 结论：boss-client 的分页应走 **API page**，不要依赖 UI 的“下一页”。

### 3.2 岗位行字段（节选）

`securityId`（长串，详情 API 用）、`encryptJobId`（`/job_detail/<id>.html` 用）、`lid`、`jobName`、`salaryDesc`、`jobExperience`、`jobDegree`、`jobLabels`、`skills`、`cityName`、`areaDistrict`、`businessDistrict`、`city`（数字码）、`gps`、`brandName`、`brandIndustry`、`brandScaleName`、`brandStageName`、`brandLogo`、`encryptBrandId`、`bossName`、`bossTitle`、`bossOnline`、`bossAvatar`、`welfareList`、`jobValidStatus`、`jobType`、`proxyJob` 等。

- **没有发布时间字段**（`published_at` 缺失）；只能记 `first_seen_at/last_seen_at`。这一点与 fuma-sales-dsh 的既有结论一致。
- 公司去重键：`encryptBrandId`；本轮石家庄第 1 页 17 个岗位链接 / 16 个公司链接，说明同一公司多岗位存在。

### 3.3 城市

- 城市是数字码：石家庄 `101090100`、北京 `101010100`。
- 城市数据可由页面接口获取：`/wapi/zpCommon/data/cityGroup.json`、`/wapi/zpgeek/common/data/city/site.json`、`/wapi/zpCommon/data/city.json`；实测均已随页面加载。
- 结论：v1 的“多城市可配置”应做成 **cityCode/cityName 注册表**（可内置常用城市 + 从上述接口刷新），不要依赖中文城市名直接拼 URL。

### 3.4 筛选条件（v1 暂不做，但接口已拿到）

`GET /wapi/zpgeek/pc/all/filter/conditions.json` 返回：

- `experienceList`（0/108/102/101/103/104/105/106/107）
- `salaryList`（0/402/403/404/405/406/407，含 lowSalary/highSalary）
- `degreeList`
- `scaleList`（0/301…306）
- `stageList`（0/801…808）
- `payTypeList`、`partTimeList`、`jobTypeList`

行业/地区来自 `/wapi/zpCommon/data/industry.json`、`businessDistrict.json` 等。v1 按用户要求先只做关键词 + 城市 + 分页，筛选留到 v1.1。

---

## 4. 岗位详情

- 页面：`https://www.zhipin.com/job_detail/<encryptJobId>.html`
- 接口：`GET /wapi/zpgeek/job/detail.json?securityId=<securityId>&_=<ts>`
  - 实测 URL 只带 `securityId` 也能成功（fuma CLI 里还带 `lid`，可作为兼容参数）。
- 响应 `zpData` 关键结构：

| 对象 | 字段（节选） |
| --- | --- |
| `jobInfo` | `encryptId`、`jobName`、`positionName`、`locationName`、`address`、`longitude/latitude`、`experienceName`、`degreeName`、`salaryDesc`、`postDescription`、`recruitmentCountDesc`、`showSkills`、`jobStatusDesc`、`jobType`、`proxyJob` |
| `bossInfo` | `name`、`title`、`tiny/large`、`activeTimeDesc`、`bossOnline`、`brandName`、`certificated` |
| `brandComInfo` | `encryptBrandId`、`brandName`、`logo`、`stage/stageName`、`scale/scaleName`、`industry/industryName`、`introduce`、`labels`、`activeTime` |
| 其他 | `pageType`、`selfAccess`、`securityId`、`sessionId`、`lid`、`oneKeyResumeInfo`、`relationInfo`、`handicappedInfo`、`appendixInfo`、`atsOnlineApplyInfo`、`certMaterials` |

- 页面正文还包含：福利标签、职位描述、招聘者在线状态、竞争力分析（个人排名）、公司介绍、工商信息摘要、工作地址、更多职位、相关职位。
- 结论：`jobs.detail` 数据量足够，v1 建议纳入（用于确认“外贸属性”和岗位要求）；请求只多 1 次/岗位，可按需开启。

---

## 5. 公司详情

### 5.1 公司主页

- URL：`https://www.zhipin.com/gongsi/<encryptBrandId>.html`
- 公司页是 **SSR/可解析 HTML**（不是纯 SPA），工商信息、简介、热招职位、招聘者都在 DOM 里；实测保存 HTML 108KB，正文完整。
- 关键 DOM：

| 区块 | 选择器 | 字段 |
| --- | --- | --- |
| 头部 | `.info-primary h1.name` / `span.name` | 公司简称 |
| 头部标签 | `.info-primary .info p` | 融资阶段（如“不需要融资”）、规模（如“20-99人”）、行业（`a.industry-link`） |
| 统计 | `.company-stat` | 在招职位数、BOSS 数 |
| 热招职位 | `.company-hotjob` | 职位名/薪资/经验/学历/地点 |
| 公司简介 | `.company-info-box` / `.job-box` | 简介正文 |
| 工商信息 | `.company-business` + `li.business-detail-*` | 见下 |
| 地址/福利 | `.job-location`、`.work-tags` | 地址、福利标签 |
| 招聘者 | `.recruiter-list` | BOSS 列表 |
| 高管 | `.manager-list` | 高管介绍 |
| 公司全称 | `.company-full-name` | 工商全称 |

- 工商信息实测选择器：
  - `.business-detail-name` 企业名称
  - `.business-detail-user` 法定代表人
  - `.business-detail-time` 成立时间
  - `.business-detail-type` 企业类型
  - `.business-detail-status` 经营状态
  - `.business-detail-money` 注册资本
  - `.business-detail-location` 注册地址
  - `.business-detail-business-time` 营业期限
  - `.business-detail-belone-location` 所属地区
  - `.business-detail-id` 统一社会信用代码
  - `.business-detail-check-time` 核准日期
  - `.business-detail-old-name` 曾用名
  - `.business-detail-orang` 登记机关
  - `li.col-auto` 经营范围
- 实测样本（已脱敏为结构示例）：企业名称/法定代表人/成立时间/企业类型/经营状态/注册资本/注册地址/营业期限/所属地区/统一社会信用代码/核准日期/登记机关/经营范围 全部拿到；统一社会信用代码为页面文本，可作为企业去重/入库的强标识，但应标注 `text_derived=true`（DOM 文本提取，非官方 API 字段）。

### 5.2 公司全部职位

- URL：`https://www.zhipin.com/gongsi/job/<encryptBrandId>.html`
- 实测：11 个在招职位，页面有职位类型/工作城市/工作经验/学历要求/薪资待遇筛选；列表项含职位名、薪资、经验、学历、招聘者、地点。
- 结论：v1 若 company detail 要“全”，建议 company detail 返回 **热招职位 + 全部在招职位**；全部职位页可单独一个操作 `companies.jobs`，避免 detail 过重。

### 5.3 公司频道 `/gongsi/`

- 页面：`https://www.zhipin.com/gongsi/`
- 这是“公司大全”频道：按城市/行业/融资阶段/公司规模筛选，列出公司卡片（本轮实测 601 个 `/gongsi/` 链接），不是按岗位关键词聚合。
- 用户 Round 1 已明确：**company list 是搜索结果去重后的公司列表**，所以 `/gongsi/` 频道 v1 不纳入；可作为 v2 的“公司目录检索”候选。

---

## 6. 页面浏览顺序（实测）

```text
1. /web/user/（登录页）
2. APP扫码登录 tab（截取 QR）
3. 验证码登录 tab → 填手机号 → 发送验证码 → 极验（点选）→ 短信已发送
4. 提交短信码 → 极验（点选）→ 登录成功
5. /（按 IP 重定向到 /shijiazhuang/）
6. /web/geek/jobs?query=外贸&city=101090100   （岗位搜索，17 岗位 / 16 公司）
7. 滚动加载更多（32 个岗位链接）
8. /job_detail/9b48...html                       （岗位详情）
9. /gongsi/?ka=header_brand                      （误点导航“公司”，非公司详情）
10. 返回 /job_detail/...
11. /gongsi/d6c1...~.html                        （公司详情，11 职位 / 3 BOSS / 工商信息）
12. /gongsi/                                     （公司大全频道，601 链接）
13. /gongsi/job/d6c1...~.html                    （公司全部职位，11 职位）
14. /job_detail/...                              （再次岗位详情）
15. /web/geek/jobs?query=外贸&city=101010100     （北京，多城市验证）
16. 页面内 API page=2 请求                        （分页验证）
```

对应的 `navigations.jsonl`、`network.jsonl`、`actions.jsonl` 有逐条时间戳；`screenshots/` 有每一步截图。

---

## 7. 风控 / 限频观察

- 本轮为中等强度探索：1 次登录 + 2 个城市搜索 + 2 页岗位 + 2 个详情 + 公司页/公司职位页，未触发 `code 37`。
- 既有 fuma-sales-dsh 在 2026-10-24 的实测：普通 Playwright/CDP 会被跳 `about:blank`；裸 HTTP 岗位详情返回 `code 37`；同一会话连续约 5 页会触发 `code 37`。
- 本轮 headful + cloakbrowser + 页面内 fetch 全程正常；未做 5 页连续压测。
- 结论：v1 仍应采用保守策略：**单并发、页间 2–4s 抖动、单次任务 ≤5 页、code37 冷却/重试**；不要用裸 HTTP。

---

## 8. 对 boss-client 的设计结论（PRD 输入）

1. **定位**：只读招聘信号客户端；`search.jobs`（关键词+城市+分页）→ `companies.list`（按 `encryptBrandId` 去重）→ `jobs.detail` / `companies.detail`（含工商信息）→ SQLite 缓存 → CLI/REST/MCP/SKILL。
2. **`name search` 语义**：本轮实测确认是**岗位关键词搜索**（`query=外贸`），不是公司名搜索；`company list` 是搜索结果聚合去重。公司频道 `/gongsi/` 不纳入 v1。
3. **`status`**：登录态 + 会话剩余天数 + 风控冷却 + 今日请求计数 + 缓存统计；**没有额度字段**。`check status` 合并进 `status`。
4. **登录**：首次必须人工介入。建议两种入口：
   - `login --qr`：headful 打开登录页，抽取 `.qr-code-box img` 的 blob → CLI 渲染 / REST Base64；轮询 `getUserInfo` 或页面登录态。
   - `login --sms`（默认）：headful 填手机号 → 发码 → 极验由人/agent 在浏览器完成 → 输入短信码 → 登录。
   - 会话复用后，服务常驻；失效时 `status.health=needs_human`，再人工一次。**不要承诺“首次全自动登录”**。
5. **数据模型**：`JobSummary / JobDetail / CompanySummary / CompanyDetail / CompanyJob / SearchQuery / Status`；`published_at` 缺失，用 `first_seen_at/last_seen_at`；公司去重键 `encryptBrandId`，工商 USCC 作为辅助强标识（`text_derived=true`）。
6. **分页**：API `page/pageSize`（默认 15，最大 100）；`resCount` 与 `totalCount` 可能不同（展示上限），不要用 `totalCount` 当全集。
7. **缓存 TTL 建议**：岗位列表 1–6h（招聘信息变化快）、岗位详情 6–24h、公司详情 7d（工商信息稳定）、公司全部职位 6h；`cached` 标记；只做结构化缓存（用户已定），不做 raw 证据链。
8. **多城市**：cityCode 注册表 + 配置默认城市列表；v1 不做薪资/经验/学历等筛选。
9. **风控**：单实例、单并发、页间延迟、单任务页数上限、code37 冷却；headless 可用于登录后的只读操作，登录/验证码需 headful。
10. **接口形态**：与 tanji-client 同构（CLI + REST 127.0.0.1 + Bearer + MCP stdio + SKILL + 统一 envelope）；`boss` 命令；端口待定 8788。

---

## 9. 未决问题（下一轮确认）

1. **登录交互模型**：接受“首次/掉线人工介入”（headful 或 REST 传 QR/验证码截图+坐标）吗？还是要求全自动（需要 captcha solver，风险高、不建议）？
2. **`login --sms` 的验证码求解**：是否提供 REST 接口把极验截图/坐标暴露给外部 agent/人？还是只依赖 headful 浏览器人工操作？
3. **`jobs.detail` 是否纳入 v1**：默认纳入（数据全、1 次请求/岗位）；如只做公司线索可砍。
4. **公司详情是否包含“全部在招职位”**：默认 `companies.detail` 返回热招 + `companies.jobs` 单独返回全部职位。
5. **PRD 草案**：是否现在按上述结论起草 `00-需求访谈记录 / 01-PRD v0.1 / 02-接口草案 v0.1`？
