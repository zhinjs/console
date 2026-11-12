# Zhin Console

Remote Console 静态前端，独立仓库部署到 GitHub Pages（与 [zhin](https://github.com/zhinjs/zhin) 文档站分离）。

- **站点**：`https://console.zhin.dev`（Settings → Pages → Custom domain）
- **Host API**：用户自托管 Zhin（默认 `http://127.0.0.1:8086`），见 [Console 文档](https://github.com/zhinjs/zhin/blob/main/docs/console/index.md)

## 本地开发

```bash
pnpm install
pnpm dev          # 默认 http://localhost:9000；代理到 VITE_DEV_API（默认 8086）
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

登录页填写 Host **API Base** + **Token**；Host 的 `corsOrigins` 需包含 Console 站点来源（如 `https://console.zhin.dev`）。

与 Host 对齐的 API（见 `{API Base}/pub/openapi.json`）：

- `GET /entries` — 插件清单
- `POST /api/console/request` — Console RPC（原 WebSocket `type` 信封）
- `GET /api/events` — SSE 推送
- `GET /api/system/status` — 登录校验

传输只走 REST + SSE，不连 `wss://…/server`。SDK 版本见下文「SDK 版本」。

可通过 URL 预填 Host 地址（可省略协议：IP 与本机/局域网地址补 `http://`，其他域名补 `https://`）：

```
https://console.zhin.dev/?apiBaseUrl=http://127.0.0.1:8086
```

也可附带 token 直接登录，**token 只能放在 `#` 片段中**（片段不会发送给服务器，不会进入静态站点访问日志）；Host 地址可用 `#apiBaseUrl=` 或原有的 `?apiBaseUrl=`：

```
https://console.zhin.dev/#apiBaseUrl=127.0.0.1:8086&token=<令牌>
```

- Console 启动时立即用 `history.replaceState` 把 token 从地址栏移除，无论登录成功与否；失败时停留在登录页显示错误，可手动重试。
- Host 不在已保存的连接中时，先弹窗显示将连接的地址，确认后才登录；取消则只填入地址。
- `?token=` 不被接受：会被立即移除且不使用，并提示「token 不能放在 ? 参数里」。
- 链接仍会留在发送渠道（聊天记录、邮件）中，只在可信渠道分享。

### 账号登录、初始化与引导（zhinjs/zhin ADR 0049 / 0053）

- 登录页默认「账号登录」（用户名 + 密码，`POST /api/auth/login`，返回的会话令牌与访问令牌一样以 Bearer 保存）；「访问令牌」用于 API 令牌、初始化令牌和不支持账号的旧 Host。`#token=` 链接总是走令牌登录。
- 登录后先读 `GET /api/auth/me`：`permissions` 交给 `setConsoleAccess`，侧栏按权限隐藏分区；旧 Host（404）按不受限处理。
- 初始化令牌（`/api/system/status` 返回 403 且 `/auth/me` 报告 `bootstrap` + `setupRequired`）只打开初始化向导：第 1 步数据库（保持当前数据库，或选择驱动、填写连接、测试、保存后等待 Host 重启），第 2 步创建所有者；完成后改用所有者会话并进入 `/onboarding`。初始化令牌不会保存到「已保存的连接」，也只保留在本次浏览器会话。
- 引导页 `/onboarding`：AI、聊天平台、完成三步，可跳过；进度优先读 Host 报告的 `onboarding`（`/auth/setup` 或 `/auth/me`），用 `onboarding.update` RPC 记录；Host 不支持时保存在本浏览器。未完成时页面顶部显示入口横幅。
- 个人设置 `/account`（顶栏用户名进入）：修改密码（`POST /api/auth/password`，成功后换用 Host 返回的新会话），我的 API 令牌（`/api/auth/tokens` 列表 / 新建 / 吊销，明文只显示一次）。
- 409 = 已初始化（初始化令牌失效，提示改用账号登录）；429 = 登录限速（读 `Retry-After`，期间禁用登录按钮）。接口类型在 `console-ui/src/contracts/console-auth.ts` 本地镜像，待 `@zhin.js/console-protocol` 发布后替换。

Console 没有单独的演示构建：公开演示是一台真实 Host，访客用只读身份登录，看到的分区与按钮由 Host 报告的权限决定（`console-ui/src/utils/console-access.mjs`）。

## 导航

侧栏按 zhinjs/zhin ADR 0052 分为六个区，前四个是「日常」，后两个是「管理」（`console-ui/src/navigation-sections.mjs`，路由表 `console-ui/src/console-routes.mjs`）：

| 区 | 菜单里的页面 | 不在菜单里、从上级页面进入 |
|------|------|------|
| 概览 | 首页 `/dashboard`、运行日志 `/logs`、机器人状态 `/agent/workbench`、Token 用量 `/agent/usage` | 决策回放 `/agent/replay` |
| 会话 | 试聊一下（`/sandbox`，sandbox 插件页）、账号与会话 `/scope`（全局对象页）、聊天记录 `/agent/sessions` | 对象树：适配器 `/scope/:adapter`、账号 `/scope/:adapter/:endpoint`、会话 `/scope/:adapter/:endpoint/:conversation`（`<kind>:<id>`） |
| 功能 | 功能矩阵 `/features`、AI 与模型 `/features/ai`、技能助手 `/features/ai/skills`、群聊插话 `/features/ai/ambient`、Workroom `/features/ai/workrooms`、运行时能力、消息场景试验台，以及没有声明分区的插件页 | 全局配置 `/features/global/:plugin`、Workroom 配置、命令权限说明、群欢迎配置流程 |
| 插件 | 插件管理 `/plugins`、插件市场 `/marketplace` | 插件详情 `/plugins/:name`（不含配置，配置在全局配置页） |
| 运维 | 数据库 `/ops/database`、配置文件 `/ops/config`、环境变量 `/ops/env`、定时任务 `/ops/schedules`、项目文件 `/ops/files`、实例 `/ops/instance`、终端 `/ops/terminal` | — |
| 访问控制 | 用户 `/access/users`、角色 `/access/roles`、API 令牌 `/access/tokens`、审计日志 `/access/audit` | — |

- 某个区里没有当前身份能看的页面时，整个区不显示。Host 还没有报告权限时（RBAC 之前的所有 Host）按不受限处理，由 Host 自己拒绝越权请求。
- 功能矩阵目前只有「全局」一列（来自插件启用状态）；Host 提供 `feature.matrix` 后自动出现每个适配器的列（`pages/features/use-feature-data.ts` 的 `useFeatureMatrix`）。账号配置页用 `feature.get` 探测 Host 是否支持分层配置，旧 Host 返回 “Unknown RPC type” 时提示需要更新。
- 对象树（`console-ui/src/scope/`）：每个对象一页，页签由层级决定——全局 / 适配器：概览 · 功能 · 角色 · 记录；账号另有聊天（账号工作区）与接入（登录、测试连接）；会话另有聊天。`?tab=` 记住页签。「功能」页签每个插件一行（有效状态、来源层级、本层覆盖、锁定层级链接），展开逐字段显示继承值 / 本层覆盖 / 有效值 / 来源，写操作走操作回执；全局「功能」是功能总览，`?view=matrix` 切到矩阵（`/features` 仍是矩阵的独立入口）。账号「接入」只讲这个账号：连接与测试、登录验证、配置入口；Host 当前没有运行的账号会说明原因，不显示空列表。角色页签读写 `chat-roles.list|grant|revoke`（ADR 0056，需要 `iam.manage`），并只读显示映射规则 `chat-roles.mappings`（协议草案；旧 Host 显示「需要新版 Host」，区块可折叠）。对象页（全局以下）只显示自己的范围面包屑，顶栏面包屑让位。设计与排版规范见 `docs/console-refactor-guidelines.md`。
- 实例不可用（网关 503 `instance_unavailable` / 504 `instance_timeout` / 502 `instance_error`）时 shell 顶部显示横幅：Retry-After 倒计时、自动重试、去「实例」页；访问控制、实例、终端等网关页不受影响。
- 旧路由保留为隐藏重定向（`LEGACY_ROUTE_REDIRECTS`）：`/endpoints` → `/scope`、`/endpoints/:a/:e` → 账号「聊天」（带 `channelType` + `channelId` 时到该会话的「聊天」）、`/features/adapters[/:a]` → `/scope[/:a]`、`/features/adapters/:a/endpoints/:e` → 账号「功能」（`?tab=conversations` → 账号概览）、`…/conversations/:c` → 会话「功能」；`/config` → `/ops/config`（`/config?plugin=x` → `/features/global/x`）、`/env` `/files` `/database` → `/ops/*`、`/tasks` `/cron` `/assistant/jobs` → `/ops/schedules`、`/agent/models` `/agent/skills` `/agent/ambient` `/agent/workrooms*` → `/features/ai/*`。
- 插件页面按 `/entries` 里声明的 `section`（区 id 如 `ops`，或区名如 `运维`）落区，未声明的进「功能」。`常用`、`机器人`、`高级` 等旧分组名仍可用，不是区名的分组显示在「功能」里。

「群聊插话」（`/features/ai/ambient`）：状态来自 `pluginRpc('root', 'ambient')`（Host 方法 `plugin.root.ambient`，需要令牌持有 `ambient:read`）。行为和范围设置用 `config:patch` + `expectedRevision` 只写 `ai.trigger.ambient`，文件保存与运行生效分别显示。旁听模型与旁听决策模型在统一模型用途页配置。

「决策回放」（`/agent/replay`，从「机器人状态」页的快捷入口进入，不在菜单里）：读 `ai_decision_events`（zhinjs/zhin ADR 0036 切片 C）。列表用 `pluginRpc('root', 'decisions')`（新的在前，`nextBefore` 翻页），点一行看整个回合用 `decision-turn`，导出用 `decisions-export` 按 `nextSince` 逐页拼成一个 JSON 文件；三者都需要令牌持有 `decisions:read`。

「技能助手」（`/features/ai/skills`）：状态来自 `pluginRpc('root', 'skills')`（Host 方法 `plugin.root.skills`，需要令牌持有 `skills:read`），页面只读统计并提供“管理模型用途”入口。管理员在 `/features/ai?tab=purposes`（“用途”页）管理六种决策用途的模式与 Profile；不再读取、猜测或写入旧的 `ai.decisions`／插件 Provider 绑定。

「运维 → 实例」（zhinjs/zhin ADR 0054 §4–§5，`pages/ops/instance.tsx`）：`gateway.instance.status` / `logs`（`status.view`，每 3 秒 / 2 秒轮询可见页）、`start` / `stop` / `restart`（`ops.restart`，先确认）；依赖面板 `gateway.packages.list`（`feature.view`），安装 / 卸载 / 更新（`plugin.manage`）先调 `gateway.packages.plan` 再确认，执行时订阅事件流 `gateway.packages.progress` 显示阶段、包管理器输出与回滚结果。安装结果带 `needsConfiguration` 时（插件 Schema 有无默认值的必填字段，ADR 0053 §2 第 4 步），每个插件显示「需要配置」卡片（缺少的配置项与环境变量），按钮打开按 Schema 生成的配置表单（`pages/ops/plugin-declare.tsx`，预填 Schema 默认值；Host 无字段定义时改为 JSON），提交调用 `gateway.plugins.declare { package, instanceKey, config }`（阶段含 `configure`，失败回滚配置；400 `invalid_input` 的字段错误就地显示并保留草稿）。引导第 4 步与插件市场安装后同样进入此表单。网关 RPC 类型暂时镜像在 `contracts/gateway.ts`（TODO：协议包发布后改为导入）；Host 不认识这些 RPC 时显示「需要新版网关」。

「运维 → 终端」（ADR 0051，`pages/ops/terminal.tsx`，需要 `ops.terminal`）：`GET /api/console/terminal/targets` 选目标 → `POST /api/console/terminal/tickets` 取一次性票据 → `WS /api/console/terminal?ticket=`；xterm.js + fit 插件，多标签各一个会话，断开后显示原因（空闲超时、被吊销、终端关闭、错误）与「重新连接」。票据不写日志、不留存。`insecureHostKey: true` 的 SSH 目标显示「未校验主机密钥」警示，打开前需再次确认。

「访问控制」（zhinjs/zhin ADR 0049）：四个页面都走 `iam.*` RPC（`pages/access/`），需要 `iam.view`；新建、改角色、禁用、删除、重置密码、角色增删改、吊销令牌需要 `iam.manage`，没有时页面只读。删除、禁用、吊销先确认，删除用户/角色要输入名称。Host 拒绝移除最后一个所有者（`code: last_owner`）时显示专门的提示。权限目录与 `IAM_RPC` 暂时在 `pages/access/access-model.mjs` 里镜像 `@zhin.js/console-protocol`，协议包发布后改为直接导入；插件声明的权限（`iam.roles.list` 回复里的 `pluginPermissions`）按插件分组显示，Host 没有报告时只显示内置目录。

插件约定页没有声明分区时，按路由在 `PLUGIN_PAGE_PLACEMENT` 里归区（目前只有 `/sandbox` → 会话），其余进「功能」。

## 目录

| 路径 | 说明 |
|------|------|
| `client/` | 入口 `main.tsx`、Host 壳、`bootstrap/` |
| `console-ui/` | 内置 Console UI（`src/`），构建别名 `@console` |
| `farm.config.ts` | `@console` → `console-ui/src` |
| `client/paths.ts` | UI 路由前缀（`VITE_CONSOLE_SHELL_PATH`、旧 `/console` 前缀） |
| `scripts/prepare-github-pages.mjs` | Pages SPA 回退与 CNAME |

运行时依赖 [@zhin.js/client](https://www.npmjs.com/package/@zhin.js/client)（SDK）与 [@zhin.js/contract](https://www.npmjs.com/package/@zhin.js/contract)（契约常量/类型）。

### SDK 版本

只使用一代 SDK：`@zhin.js/client` 1.1.x、`@zhin.js/contract` 1.1.x、`@zhin.js/ai` 1.1.x，与 zhin 仓库 `packages/console/*` 当前发布线一致（npm 的 `latest`）。`package.json` 用 `~` 范围，因为 npm 上还有不属于这条线的 `@zhin.js/client` 2.x 和 `@zhin.js/ai` 1.5.x，`^` 会把它们装进来并在 lockfile 里产生第二份 contract / console-protocol / ai。`tests/console-contract.test.mjs` 检查这些范围，以及 lockfile 里每个包只有一个版本。

- 路由/工具注册表（`createConsoleApp()`）和当前 Host 会话的 `ConsoleClient` 由 `console-ui/src/utils/console-client.ts` 持有；`client/main.tsx` 用 `ConsoleClientProvider` 把它交给 SDK 的 hooks（`useConsoleTransport`、`useEnvFiles`、`useEngagements` 等）。
- React 之外的代码用 `getConsoleTransport()`。登出、401 或更换 Host 时 `resetConsoleRuntime()` 丢弃旧 transport，路由注册表保留。
- 需要 Node.js ≥ 22.19（与 SDK 的 `engines` 一致）。

## CI / Pages

- `.github/workflows/ci.yml`：对 `main` 的 pull request 以及 push 到 `main` / `codex/**` 时运行 typecheck、test、build。
- `.github/workflows/pages.yml`：push `main` 时先跑 typecheck 和 test，通过后构建并部署 GitHub Pages。

可选仓库变量：

- `CONSOLE_PAGES_CNAME` — 默认 `console.zhin.dev`
- `CONSOLE_PAGES_BASE` — 自定义域留空；仅 `*.github.io/<repo>/` 子路径时设为 `/console`

## 插件安装与配置

市场先核验 npm 的实际版本，再生成绑定包版本、实例和项目修订的安装计划。安装后分别查看依赖、实例声明、配置校验、等待应用、当前代发布及平台就绪；就绪不代表业务验证通过。依赖文件变化不会在插件管理操作完成前打断 Host，应用需要显式确认。

安装回执丢失时先只读核对；仅当相同版本已经安装、尚未声明且没有依赖问题，才能生成新的补全挂载计划，确认后继续配置，不能自动重放旧操作。业务检查先披露范围与副作用，再批准一次；旧代结果与未知执行结果不能用当前插件状态替代。

配置文件页（`/ops/config`；旧 `/config` 重定向到这里，`/config?plugin=` 重定向到对应的 `/features/global/:plugin`）按通用设置、Agent 预设和插件配置组织。通用设置与插件先展示用途列表，点击后进入详情；插件区分内置能力、已安装与自定义、未识别的已保存配置。模型管理只有 `/features/ai` 一个入口（导航与命令面板各一处）：当前标签页写入 `?tab=`（`profiles`／`accounts`／`services`／`purposes` 或个人的 `sessions`，无效值回到 `profiles`），刷新和分享链接可直达；旧的 `/config?section=models`（含 `ai:inference`）重定向到该页并保留 `tab`。它管理运行时 Service／账号／Profile／用途，使用 `/api/agent/inference` 的 plan/apply 与持久 mutation 回查，不创建文件草稿，也不把文件应用状态当作图提交回执。Agent 预设编辑 `ai.agents`；其他静态 AI 设置按对话与执行、会话、记忆、图片、外部服务等能力分别进入，共用同一份 `ai` 文件草稿和保存版本。模型 plan 只在用户显式导入时处理，密钥与登录状态不随 plan 导入导出。 模型草稿绑定打开时读取的图版本；刷新列表不重置或替旧草稿更新基线，冲突后需重新打开编辑。只有本人已确认提交对应的读取结果可以开始下一次保存，结果未知时只查询回执。

模型接入状态沿用 Host 的 Driver 展示声明；仅实验项显示短标识，必要说明只在选定详情或当前登录流程展示。它不改变账号状态、权限、可选范围或保存参数。

设置详情复用 Host 的 Schema，支持嵌套对象、数组、字典、联合类型、元组和顶层单值。未修改的可选字段保持省略并沿用声明默认值；明确修改才产生覆盖。任意 JSON 字段只在该字段内编辑，不使整份配置退回源码；配置编辑通过保存提交；运行应用由状态面板单独处理；直接编辑 YAML/JSON 请使用文件管理。插件声明通过插件管理调整。Host 提供精确路径与原始 Schema 校验，草稿绑定开始编辑时的文件修订；切换配置项保留草稿，刷新不能为旧草稿背书。插件挂载与启停通过插件管理入口操作。Host 未提供可编辑路径时，只展示说明和文件管理入口；第三方未声明 Schema 时明确显示缺失，不按现有值猜字段类型。

表单保存与运行生效分开呈现。新版 Host 返回配置应用明细时，设置页显示与文件修订关联的已生效、待重启、依赖阻塞、失败、结果未确认和被替代的变更组，并显示更新方式与路径。用户可以显式“应用已保存配置”；此动作只提交当前文件修订，不保存草稿、不重启进程，也不调用插件管理的 `plugin:apply`。结果未知时先只读刷新核对，不自动重试；校验失败和修订冲突分别说明。证据属于旧文件版本时不会标成当前版本已生效。旧 Host 缺少明细时保留保存/重启提示，明确不代表已确认生效。实例声明、应用和业务验证仍在插件管理中独立处理。

组件画廊可按目标 Endpoint、会话、父频道和线程预览，显示实际投影形式与降级原因。预览不发送消息、不注册按钮、不执行出站中间件。会话历史读取正式 Inbox 字段与平台消息 ID；有诊断的出站记录展示最终投递形式，缺少历史方向或诊断时明确提示，不猜测。

## 管理员任务中心

“自动化与扩展 → 任务中心”读取 Host 的用途目录与当前已加载任务提供方。用途指导与 CLI 共用目录；安装、插件实例配置仍走现有市场和配置流程。只有明确提供管理员任务能力的插件才能在此创建任务，聊天中的个人任务仍归原发送者，不会导入或冒充管理员任务。

创建前选择 Host 返回的完整 Endpoint，再明确填写会话、父容器与话题，核对完整目标、提供方所需参数与执行规则及未来影响。表单编辑复用 SchemaFieldEditor，不写 Root 配置或发送测试消息；复杂 Schema 保守拒绝部分保存。修改、暂停、恢复和取消以提供方的实际 actions 为准，修改保留原始投递目标。`unknown` 任务只能按提供方允许的方式取消，不能恢复或重试；取消不能撤回在途发送。

操作回执丢失时保留原 requestId 并冻结写入，只读刷新后按持久 mutation receipt 核对 taskId。该确认只证明任务变更，不证明平台投递。找不到确认不代表未执行，也不会自动重发。会话存储只保存操作身份、Host 地址和不含凭据的连接 scope，不保存任务正文或目标参数；换登录或重载后需要管理员明确选择用当前身份核对原操作。没有 `ops.schedule.write` 的身份不能执行任务写操作。

## 消息处理诊断

在会话顶部选择“最近诊断”，或打开一条入站消息旁的诊断操作，可以查看实际处理阶段、指令状态、回复目标与投递结果。查询使用完整 Endpoint、会话、父容器、话题及平台消息 ID，不按正文猜测，也不会重放消息。

需要 Host 提供 `GET /api/messages/diagnostics` 且具有 full scope；旧 Host 会明确提示更新。Host 仅在内存保存最近 15 分钟、最多 500 条记录，重启或过期后的空结果不代表消息成功。记录不另存正文或原始异常。

“入站处理已结束”不代表 Agent 或业务任务完成；“出站投影”不证明已发送，Endpoint 返回消息 ID 也不保证远端展示。投递结果不确定时，应先核实实际会话，不能盲目重发。

## 界面语言 / Interface language

登录页和工作台可手动选择简体中文或英文，默认中文，偏好仅保存在当前浏览器站点。它独立于 Bot 语言和时区；切换保留配置值和未保存草稿。Schema 可通过 `x-i18n.en` 声明标题、说明和按稳定值映射的选项标签，第三方未提供翻译的原文保持不变。详见[界面语言与 Schema 扩展](docs/localization.md)。

Choose Simplified Chinese or English on the sign-in screen or dashboard. This preference is local to the Console, independent of the Bot language and timezone. Configuration values, user content, and unsaved drafts are preserved. See [interface language and Schema metadata](docs/localization.md).

「Token 用量」（`/agent/usage`）：读 `pluginRpc('root', 'usage-stats')`（Host 方法 `plugin.root.usage-stats`，只读，依赖 zhin 的 `feat/console-usage-stats`）。按时间范围（今天 / 近 7 天 / 近 30 天 / 自定义）、粒度（自动 / 小时 / 天）和会话筛选；展示总输入 / 输出、缓存命中率（含单次调用 P50 / P90）、按时间堆叠的输入、命中率折线、按模型的输入 / 输出 / 缓存读取、输入构成和用量最高的会话。图表是仓库内的零依赖 SVG（`token-usage-charts.tsx`），缓存写入和分位数等新字段缺失时自动隐藏。无权限（401/403）时显示无权限提示。
