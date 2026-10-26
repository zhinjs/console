# Zhin Console

Remote Console 静态前端，独立仓库部署到 GitHub Pages（与 [zhin](https://github.com/zhinjs/zhin) 文档站分离）。

- **站点**：`https://console.zhin.dev`（Settings → Pages → Custom domain）
- **Host API**：用户自托管 Zhin（默认 `http://127.0.0.1:8086`），见 [console-remote](https://github.com/zhinjs/zhin/blob/main/docs/console-remote.md)

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
- `GET /api/events` — SSE 推送（`@zhin.js/client` ≥ 1.1.0）
- `GET /api/system/status` — 登录校验

依赖 `@zhin.js/client` **≥ 2.0.5**、`@zhin.js/contract` **≥ 1.0.3**（REST+SSE，不再连 `wss://…/server`；含 agent-stream 与 runtime Token）。

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
- push `main` 即自动部署；GitHub Actions `demo-pages.yml` 仅作备用（Pages 环境目前只允许 `main`）
- **Host 侧**：Hugging Face Space [`zhinjs-demo.hf.space`](https://zhinjs-demo.hf.space)（Token `zhin-demo`）

## 导航

Console 面向普通用户（[zhin#970](https://github.com/zhinjs/zhin/issues/970)），侧栏分组定义在 `console-ui/src/navigation-taxonomy.ts`：

| 分组 | 页面 |
|------|------|
| 常用 | 首页、聊天账号、聊天记录、定时提醒、运行记录 |
| 机器人 | 机器人状态、试聊一下（sandbox 插件页）、助手任务（启用助手时）、群聊插话 |
| 功能 | 功能管理、功能商店、任务中心 |
| 高级（默认折叠） | 配置、环境变量、项目文件、数据库、运行时能力、消息场景试验台、Workroom |

「机器人」分组名是对外约定，后续新页挂在它下面。

「群聊插话」（`/agent/ambient`）：状态来自 `pluginRpc('root', 'ambient')`（Host 方法 `plugin.root.ambient`，需要令牌持有 `ambient:read`），设置用 `config:patch` + `expectedRevision` 只写 `ai.trigger.ambient` 下的几个键，保存后总会提示是否需要重启。插件约定页没有分组字段，已知页面按路由在 `PLUGIN_PAGE_PLACEMENT` 里归组，其余进「其他」。原有路由路径不变，旧链接继续可用。

## 目录

| 路径 | 说明 |
|------|------|
| `client/` | 入口 `main.tsx`、Host 壳、`bootstrap/` |
| `console-ui/` | 内置 Console UI（`src/`），构建别名 `@console` |
| `farm.config.ts` | `@console` → `console-ui/src` |
| `client/paths.ts` | Host API 路径常量；UI 默认根路径 `/dashboard` |
| `scripts/prepare-github-pages.mjs` | Pages SPA 回退与 CNAME |

运行时依赖 [@zhin.js/client](https://www.npmjs.com/package/@zhin.js/client)（SDK）与 [@zhin.js/contract](https://www.npmjs.com/package/@zhin.js/contract)（契约常量/类型）。

## CI / Pages

`.github/workflows/pages.yml`：push `main` 即部署。

可选仓库变量：

- `CONSOLE_PAGES_CNAME` — 默认 `console.zhin.dev`
- `CONSOLE_PAGES_BASE` — 自定义域留空；仅 `*.github.io/<repo>/` 子路径时设为 `/console`

## 插件安装与配置

市场先核验 npm 的实际版本，再生成绑定包版本、实例和项目修订的安装计划。安装后分别查看依赖、实例声明、配置校验、等待应用、当前代发布及平台就绪；就绪不代表业务验证通过。依赖文件变化不会在插件管理操作完成前打断 Host，应用需要显式确认。

安装回执丢失时先只读核对；仅当相同版本已经安装、尚未声明且没有依赖问题，才能生成新的补全挂载计划，确认后继续配置，不能自动重放旧操作。业务检查先披露范围与副作用，再批准一次；旧代结果与未知执行结果不能用当前插件状态替代。

配置默认展示全部 Schema 字段，支持嵌套对象、数组、字典、联合类型、元组和顶层单值。每项配置可主动切换表单与带高亮的 JSON 源码，共用同一草稿；任意 JSON 字段只在该字段内编辑，不使整份配置退回源码。完整 YAML/JSON 文件仍有独立入口。Host 提供精确路径与原始 Schema 校验，草稿绑定开始编辑时的文件修订；切换配置项保留草稿，刷新不能为旧草稿背书。插件挂载与启停通过插件管理入口操作。第三方未声明 Schema 时明确显示缺失，不按现有值猜字段类型。

插件表单可读取同一文件版本与当前运行代的应用证据。未保存草稿阻止应用；保存不等于生效，业务验证仍独立。应用回执或后续查询未确认时，只读核对而不自动重新申请；同认证连接内离开页面再返回保留待确认记录。整页刷新重建连接后需重新读取最新证据，不承诺跨刷新持久对账。源码和表单保存均按实际回执说明是否需要重启。

组件画廊可按目标 Endpoint、会话、父频道和线程预览，显示实际投影形式与降级原因。预览不发送消息、不注册按钮、不执行出站中间件。会话历史读取正式 Inbox 字段与平台消息 ID；有诊断的出站记录展示最终投递形式，缺少历史方向或诊断时明确提示，不猜测。

## 管理员任务中心

“自动化与扩展 → 任务中心”读取 Host 的用途目录与当前已加载任务提供方。用途指导与 CLI 共用目录；安装、插件实例配置仍走现有市场和配置流程。只有明确提供管理员任务能力的插件才能在此创建任务，聊天中的个人任务仍归原发送者，不会导入或冒充管理员任务。

创建前选择 Host 返回的完整 Endpoint，再明确填写会话、父容器与话题，核对完整目标、提供方所需参数与执行规则及未来影响。表单编辑复用 SchemaFieldEditor，不写 Root 配置或发送测试消息；复杂 Schema 保守拒绝部分保存。修改、暂停、恢复和取消以提供方的实际 actions 为准，修改保留原始投递目标。`unknown` 任务只能按提供方允许的方式取消，不能恢复或重试；取消不能撤回在途发送。

操作回执丢失时保留原 requestId 并冻结写入，只读刷新后按持久 mutation receipt 核对 taskId。该确认只证明任务变更，不证明平台投递。找不到确认不代表未执行，也不会自动重发。会话存储只保存操作身份、Host 地址和不含凭据的连接 scope，不保存任务正文或目标参数；换登录或重载后需要管理员明确选择用当前身份核对原操作。Demo 禁用所有任务写操作。

## 消息处理诊断

在会话顶部选择“最近诊断”，或打开一条入站消息旁的诊断操作，可以查看实际处理阶段、指令状态、回复目标与投递结果。查询使用完整 Endpoint、会话、父容器、话题及平台消息 ID，不按正文猜测，也不会重放消息。

需要 Host 提供 `GET /api/messages/diagnostics` 且具有 full scope；旧 Host 会明确提示更新。Host 仅在内存保存最近 15 分钟、最多 500 条记录，重启或过期后的空结果不代表消息成功。记录不另存正文或原始异常。

“入站处理已结束”不代表 Agent 或业务任务完成；“出站投影”不证明已发送，Endpoint 返回消息 ID 也不保证远端展示。投递结果不确定时，应先核实实际会话，不能盲目重发。

## 已保存配置的字段解释

插件配置中的“字段来源与运行代一致性”通过手动读取 `config:explain`（需要 full 权限）。它绑定当前已读取的文件版本，显示候选字段来自文件、Schema 默认值、未设置或无法证明，并展示读取时与运行代的一致性；不展示配置值或环境变量展开值。未保存草稿保持独立，解释不会覆盖草稿。

运行代来源未记录时始终显示未知，值一致不能证明来源一致；敏感或环境引用未比较不等于通过。复杂 Schema、自定义解析和版本漂移会明确提示无法解释，保留完整源码入口，不执行应用、业务验证或发送。Demo 不请求此接口，切换 Host、凭据或文件版本会丢弃旧结果。
