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

可通过 URL **仅预填** Host 地址（`token` 须在登录页手动输入，勿放在 URL 中）：

```
https://console.zhin.dev/?apiBaseUrl=http://127.0.0.1:8086
```

Demo 构建会写入 `window.__ZHIN_API_TOKEN`（对齐 zhin `deploy/zhin-demo`），UI 与 SDK 均优先读该运行时 Token，避免仅依赖 localStorage。
## Demo 站点（demo.zhin.dev）

**与 console.zhin.dev 不同**：Demo 构建固定预连 `https://zhinjs-demo.hf.space`（Token `zhin-demo`），跳过登录，默认打开 **试聊一下**（沙盒）；菜单与正式站一致，不再隐藏管理页。

### 本地联调

```bash
pnpm dev:demo
# 或覆盖为本机 Host
VITE_DEMO_MODE=1 VITE_API_BASE=http://127.0.0.1:8086 VITE_API_TOKEN=... pnpm dev
```

### 生产构建

```bash
cp .env.demo.example .env.demo   # 默认已指向 hf.space / zhin-demo
set -a && source .env.demo && set +a && pnpm build:demo
pnpm pages:prepare   # CONSOLE_PAGES_CNAME=demo.zhin.dev
```

### 部署

- **实际托管**：Cloudflare Pages 项目 `console`（自定义域 `demo.zhin.dev`），监听 **`main`**，构建命令 `pnpm run build:demo`
- push `main` 即自动部署；Demo 站没有 GitHub Actions 部署流程（GitHub Pages 环境只发布 console.zhin.dev）
- **Host 侧**：Hugging Face Space [`zhinjs-demo.hf.space`](https://zhinjs-demo.hf.space)（Token `zhin-demo`）

## 导航

Console 面向普通用户（[zhin#970](https://github.com/zhinjs/zhin/issues/970)），侧栏分组定义在 `console-ui/src/navigation-taxonomy.ts`：

| 分组 | 菜单里的页面 | 不在菜单里、从上级页面进入 |
|------|------|------|
| 会话 | 试聊一下（`/sandbox`，sandbox 插件页）、聊天记录 | — |
| 任务 | 任务、Workroom | 群欢迎配置流程、定时提醒、助手任务（从「任务」进入）；Workroom 配置 |
| 聊天账号 | 聊天账号 | 聊天账号详情 |
| 插件 | 插件管理、插件市场，以及没有声明分组的插件页 | 插件详情 |
| 运行维护 | 首页、机器人状态、运行日志、Token 用量 | 决策回放（从「机器人状态」进入） |
| 高级（默认折叠） | 运行时能力、项目文件、数据库、消息场景试验台 | 命令权限说明（从「运行时能力」进入） |
| 设置（侧栏底部） | 设置、环境变量、群聊插话、技能助手、模型 | — |

内置页面在 `console-ui/src/registerBuiltinShell.tsx` 注册。「群聊插话」「技能助手」「决策回放」只对持有相应权限的令牌显示。

`常用`、`机器人`、`功能`、`高级`、`其他` 是已发布插件使用的分组名，继续保留：插件声明了这些分组时按原名显示。

「群聊插话」（`/agent/ambient`）：状态来自 `pluginRpc('root', 'ambient')`（Host 方法 `plugin.root.ambient`，需要令牌持有 `ambient:read`）。行为和范围设置用 `config:patch` + `expectedRevision` 只写 `ai.trigger.ambient`，文件保存与运行生效分别显示。旁听模型与旁听决策模型在统一模型用途页配置。

「决策回放」（`/agent/replay`，从「机器人状态」页的快捷入口进入，不在菜单里）：读 `ai_decision_events`（zhinjs/zhin ADR 0036 切片 C）。列表用 `pluginRpc('root', 'decisions')`（新的在前，`nextBefore` 翻页），点一行看整个回合用 `decision-turn`，导出用 `decisions-export` 按 `nextSince` 逐页拼成一个 JSON 文件；三者都需要令牌持有 `decisions:read`。

「技能助手」（`/agent/skills`）：状态来自 `pluginRpc('root', 'skills')`（Host 方法 `plugin.root.skills`，需要令牌持有 `skills:read`），页面只读统计并提供“管理模型用途”入口。管理员在 `/agent/models` 的“用途”页管理六种决策用途的模式与 Profile；不再读取、猜测或写入旧的 `ai.decisions`／插件 Provider 绑定。

插件约定页没有声明分组时，按路由在 `PLUGIN_PAGE_PLACEMENT` 里归组（目前只有 `/sandbox` → 会话），其余进「插件」。原有路由路径不变，旧链接继续可用。

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

设置页（保留 `/config` 和原有 `?plugin=` 链接）按通用设置、模型、Agent 预设和插件配置组织。通用设置与插件先展示用途列表，点击后进入详情；插件区分内置能力、已安装与自定义、未识别的已保存配置。“模型”与 `/agent/models` 共用运行时 Service／账号／Profile／用途管理，使用 `/api/agent/inference` 的 plan/apply 与持久 mutation 回查，不创建文件草稿，也不把文件应用状态当作图提交回执。Agent 预设编辑 `ai.agents`；其他静态 AI 设置按对话与执行、会话、记忆、图片、外部服务等能力分别进入，共用同一份 `ai` 文件草稿和保存版本。模型 plan 只在用户显式导入时处理，密钥与登录状态不随 plan 导入导出。 模型草稿绑定打开时读取的图版本；刷新列表不重置或替旧草稿更新基线，冲突后需重新打开编辑。只有本人已确认提交对应的读取结果可以开始下一次保存，结果未知时只查询回执。

模型接入状态沿用 Host 的 Driver 展示声明；仅实验项显示短标识，必要说明只在选定详情或当前登录流程展示。它不改变账号状态、权限、可选范围或保存参数。

设置详情复用 Host 的 Schema，支持嵌套对象、数组、字典、联合类型、元组和顶层单值。未修改的可选字段保持省略并沿用声明默认值；明确修改才产生覆盖。任意 JSON 字段只在该字段内编辑，不使整份配置退回源码；配置编辑通过保存提交；运行应用由状态面板单独处理；直接编辑 YAML/JSON 请使用文件管理。插件声明通过插件管理调整。Host 提供精确路径与原始 Schema 校验，草稿绑定开始编辑时的文件修订；切换配置项保留草稿，刷新不能为旧草稿背书。插件挂载与启停通过插件管理入口操作。Host 未提供可编辑路径时，只展示说明和文件管理入口；第三方未声明 Schema 时明确显示缺失，不按现有值猜字段类型。

表单保存与运行生效分开呈现。新版 Host 返回配置应用明细时，设置页显示与文件修订关联的已生效、待重启、依赖阻塞、失败、结果未确认和被替代的变更组，并显示更新方式与路径。用户可以显式“应用已保存配置”；此动作只提交当前文件修订，不保存草稿、不重启进程，也不调用插件管理的 `plugin:apply`。结果未知时先只读刷新核对，不自动重试；校验失败和修订冲突分别说明。证据属于旧文件版本时不会标成当前版本已生效。旧 Host 缺少明细时保留保存/重启提示，明确不代表已确认生效。实例声明、应用和业务验证仍在插件管理中独立处理。

组件画廊可按目标 Endpoint、会话、父频道和线程预览，显示实际投影形式与降级原因。预览不发送消息、不注册按钮、不执行出站中间件。会话历史读取正式 Inbox 字段与平台消息 ID；有诊断的出站记录展示最终投递形式，缺少历史方向或诊断时明确提示，不猜测。

## 管理员任务中心

“自动化与扩展 → 任务中心”读取 Host 的用途目录与当前已加载任务提供方。用途指导与 CLI 共用目录；安装、插件实例配置仍走现有市场和配置流程。只有明确提供管理员任务能力的插件才能在此创建任务，聊天中的个人任务仍归原发送者，不会导入或冒充管理员任务。

创建前选择 Host 返回的完整 Endpoint，再明确填写会话、父容器与话题，核对完整目标、提供方所需参数与执行规则及未来影响。表单编辑复用 SchemaFieldEditor，不写 Root 配置或发送测试消息；复杂 Schema 保守拒绝部分保存。修改、暂停、恢复和取消以提供方的实际 actions 为准，修改保留原始投递目标。`unknown` 任务只能按提供方允许的方式取消，不能恢复或重试；取消不能撤回在途发送。

操作回执丢失时保留原 requestId 并冻结写入，只读刷新后按持久 mutation receipt 核对 taskId。该确认只证明任务变更，不证明平台投递。找不到确认不代表未执行，也不会自动重发。会话存储只保存操作身份、Host 地址和不含凭据的连接 scope，不保存任务正文或目标参数；换登录或重载后需要管理员明确选择用当前身份核对原操作。Demo 禁用所有任务写操作。

## 消息处理诊断

在会话顶部选择“最近诊断”，或打开一条入站消息旁的诊断操作，可以查看实际处理阶段、指令状态、回复目标与投递结果。查询使用完整 Endpoint、会话、父容器、话题及平台消息 ID，不按正文猜测，也不会重放消息。

需要 Host 提供 `GET /api/messages/diagnostics` 且具有 full scope；旧 Host 会明确提示更新。Host 仅在内存保存最近 15 分钟、最多 500 条记录，重启或过期后的空结果不代表消息成功。记录不另存正文或原始异常。

“入站处理已结束”不代表 Agent 或业务任务完成；“出站投影”不证明已发送，Endpoint 返回消息 ID 也不保证远端展示。投递结果不确定时，应先核实实际会话，不能盲目重发。

## 界面语言 / Interface language

登录页和工作台可手动选择简体中文或英文，默认中文，偏好仅保存在当前浏览器站点。它独立于 Bot 语言和时区；切换保留配置值和未保存草稿。Schema 可通过 `x-i18n.en` 声明标题、说明和按稳定值映射的选项标签，第三方未提供翻译的原文保持不变。详见[界面语言与 Schema 扩展](docs/localization.md)。

Choose Simplified Chinese or English on the sign-in screen or dashboard. This preference is local to the Console, independent of the Bot language and timezone. Configuration values, user content, and unsaved drafts are preserved. See [interface language and Schema metadata](docs/localization.md).

「Token 用量」（`/agent/usage`）：读 `pluginRpc('root', 'usage-stats')`（Host 方法 `plugin.root.usage-stats`，只读，依赖 zhin 的 `feat/console-usage-stats`）。按时间范围（今天 / 近 7 天 / 近 30 天 / 自定义）、粒度（自动 / 小时 / 天）和会话筛选；展示总输入 / 输出、缓存命中率（含单次调用 P50 / P90）、按时间堆叠的输入、命中率折线、按模型的输入 / 输出 / 缓存读取、输入构成和用量最高的会话。图表是仓库内的零依赖 SVG（`token-usage-charts.tsx`），缓存写入和分位数等新字段缺失时自动隐藏。无权限（401/403）时显示无权限提示。
