# Console 重构：设计与排版规范

本规范供重构第二阶段起改写子页面时使用。第一阶段已经落地的地基：对象树路由、对象页框架、统一状态组件、操作回执和实例不可用横幅。新页面和改写的页面都按本文执行；与本文冲突的旧写法在改到该页面时一并替换。

## 1. 信息架构：四级对象树

主干是 `全局 ─ 适配器 ─ 账号 ─ 会话`（zhinjs/zhin ADR 0050 / 0055 / 0056）。每个对象只有一个页面，所有关于它的内容都放在这一页的页签里。

| 层级 | 路由 | 页签（顺序固定，见 `SCOPE_TABS`） |
|---|---|---|
| 全局 | `/scope` | 概览（全部账号）· 功能（功能矩阵）· 角色 · 记录 |
| 适配器 | `/scope/:adapter` | 概览（账号与连接管理）· 功能 · 角色 · 记录 |
| 账号 | `/scope/:adapter/:endpoint` | 概览（会话列表）· 聊天 · 接入 · 功能 · 角色 · 记录 |
| 会话 | `/scope/:adapter/:endpoint/:conversation` | 概览 · 聊天 · 功能 · 角色 · 记录 |

- 会话段是 `<kind>:<id>` 整体 URI 编码（`kind` 为 `group` / `private` / `channel`）。Host 解析键 `<alias>/<endpointId>/<kind>:<id>` 只转义 `%`→`%25` 与 `/`→`%2F`，由 `scopeKey()` 生成，页面不要自己拼。
- 链接一律用 `scopeHref(scope, tab)`，或 `adapterHref` / `endpointHref` / `conversationHref`（`console-routes.mjs`）。`概览` 是默认页签，不写进 URL。
- 页面读取当前对象用 `parseScopePath(location.pathname)`，不用 `useParams`：路由器会把解码后的 `%2F` 变回 `/`，含 `%2F` 的 ID 会读错。
- 旧路由只做隐藏重定向（`LEGACY_ROUTE_REDIRECTS`），书签不失效。新增重定向时同步补 `tests/console-routes.test.mjs`。
- 功能矩阵 `/features` 保留为总览入口；插件详情只讲插件本身，「在哪开了」链到对象树，不再重复列表。

## 2. 布局栅格与断点

| 断点 | 宽度 | 布局 |
|---|---|---|
| 手机 | 320–767px | 单列；页头动作占满一行；页签横向滚动，不换行；详情用底部抽屉（`Sheet side="bottom"`） |
| 平板 / 笔记本 | 768–1439px | 单列内容区，最大宽度跟随 `console-content-frame`；对象页 `fullWidth` 的层级（账号、会话）铺满 |
| 宽屏 | ≥1440px | 有 `aside`（下级对象列表）时两列：`18rem` 侧栏 + 内容，侧栏 `sticky` |

- 移动端路径是「列表 → 内容 → 详情」：在上级对象页的列表里点对象进入它的页面（内容），对象内的单条明细用抽屉打开（详情），返回靠浏览器后退或面包屑，不在同一屏同时摆三栏。
- 所有页面在 320px 宽下不得出现横向滚动条（表格放进 `Card overflow-hidden`，宽表格在小屏改为卡片或只保留关键列）。
- 截图验收：1440 与 375 两个宽度 × 亮暗两种主题。

## 3. 间距与字号

只用设计令牌（`theme-tokens.css` / `design-system.css`），不写死颜色和像素字号。

- 区块间距：页面内区块之间 `var(--console-space-section)`；页头与页签之间 `1rem`（手机 `0.75rem`）；同一区块内元素 `0.75rem`；行内控件 `0.5rem`。
- 卡片内边距：`p-4`（16px），紧凑表格行为表格默认值。
- 字号角色：页标题 `console-page-title`，区块标题 `console-section-title`，正文 `--console-text-body`，辅助说明 `--console-text-body-sm` + `muted-foreground`，标签与徽标 `--console-text-caption`。徽标不小于 12px。
- 身份（适配器别名、账号 ID、会话 ID、范围键）用等宽字体 `code`，超长截断并保留 `title`。

## 4. 页头

对象页的页头由 `ObjectPageLayout` 统一渲染，页面不要再放 `PageHeader` 或「返回」按钮：

1. 面包屑 `ScopeBreadcrumb`：每一级带层级名（适配器 / 账号 / 群聊…），祖先可点；全局页不显示。
2. 标题行：图标、显示名（没有就用 ID）、层级徽标、平台徽标、状态徽标（在线 / 离线 / 有覆盖 / 已锁定）。
3. 一句话说明（这一页能做什么）。
4. 完整身份 `qq / bot-1 / group:123`，旁边复制按钮复制 Host 范围键。
5. 右侧动作：页面自己的动作（刷新、打开聊天）+ 固定的「切换范围」`ScopePicker`。切换范围只改变查看对象，不授予权限，选择器底部写明这一点。

非对象页（运维、访问控制等）继续用 `PageShell` + `PageHeader`，标题与说明的写法相同。

## 5. 页签

- 页签由层级决定（`SCOPE_TABS`），页面只提供各页签的内容 `panels`；不要在页签内容里再套一层 Tabs 作为主导航。
- 当前页签写在 `?tab=`，切换用 `replace`，不产生历史记录；无效值回到概览。
- 无权限的页签仍然显示（带锁图标），内容是 `StatusState kind="forbidden"` 并列出需要的权限（`SCOPE_TAB_PERMISSIONS`）。不要悄悄隐藏。
- 只挂载当前页签，离开即卸载；需要保留草稿的页签自己用未保存修改守卫。
- 「聊天」页签铺满（`flushTabs`），工作区放在 `.console-object-chat` 容器里，有固定工作高度。

## 6. 列表与详情

- 列表用表格（`Table`）或卡片网格（`console-resource-list`）；每行的主名称本身就是去对象页的链接，右侧最多两个次要动作（如「聊天」「功能」）。
- 有搜索时放在列表上方，输入停顿 300ms 后再查询；筛选用 `aria-pressed` 的按钮组或复选框。
- 分页用「加载更多」，不要页码。
- 单条明细（成员、消息诊断、权限解释）在宽屏放右侧检查器，在手机放底部抽屉。

## 7. 表单分组

- 一组相关字段放进一个 `ObjectSection`（标题 + 一句说明 + `Card`），字段标签在上、输入在下；宽屏可一行多列（`md:grid-cols-…`），手机一列。
- 只读字段（例如账号层的适配器）用禁用输入并说明原因，不要藏起来。
- 继承关系写清楚：每个可覆盖字段显示来源（全局 / 适配器 / 账号 / 会话），被上级锁定的显示锁和锁定层级的链接（`FeatureLockNote`）。
- 保存与生效分开呈现：保存回执说明已写入，生效状态另行显示。

## 8. 写操作与危险操作：ActionReceipt

所有写操作走 `useActionReceipt` + `<ActionReceipt>`：

```
准备（列出要改什么）→ 确认（危险操作再确认一次）→ 提交 → 成功 / 部分失败 / 结果未知 / 未执行
```

- `prepare(plan)`：`title` 写清动作与对象（「授予 管理员：qq / 10001」），`changes` 逐条列出变化，危险操作 `danger: true`。
- 提交中不能取消、不能重复提交；按钮在提交期间禁用。
- **结果未知**（超时、断连、网关 504 `instance_timeout` / 502 `instance_error`）：只提供「核对当前状态」（`verify`，只读重新读取），绝不自动或手动重放写操作。
- **未执行**（Host 明确拒绝：权限、校验、冲突、锁定，或 503 `instance_unavailable` 的 `not-dispatched`）：显示原因，可以重新准备。
- 回执就地显示在发起操作的控件附近，直到用户关闭；toast 只用于不需要追踪结果的轻提示。
- 删除、撤销、全局停用等不可逆或影响面大的操作必须 `danger: true`；删除类再要求输入名称的，沿用现有 `confirm-dialog`。

## 9. 空态与错误态：StatusState

一种情况只有一种说法，统一用 `<StatusState>`（`kind` 或 `error` 二选一；`error` 由 `statusFromError` 解析 `ConsoleTransportError` 的 `details.serverCode`、`code` 与文本）：

| kind | 何时 | 动作 |
|---|---|---|
| `empty` 无数据 | 读取成功但没有内容 | 说明内容从哪来、怎么产生；可给一个去创建的入口 |
| `forbidden` 无权限 | 403 / `forbidden` / 「没有 … 权限」 | 列出需要的权限；不要显示重试 |
| `not-installed` 未安装 | 所需插件或适配器不存在 | 去插件市场 |
| `unsupported` 需要新版 Host | `Unknown RPC type` | 说明升级后会出现什么 |
| `locked` 已锁定 | 409 `locked` + `lockedBy` | 「查看上级设置」链到锁定层级 |
| `conflict` 内容已被修改 | 409 `conflict` / 写结果 `status: 'conflict'` | 重新读取后再决定，不自动覆盖 |
| `database-busy` 数据库忙 | 503 `database_busy`（Retry-After） | 显示建议等待秒数与重试 |
| `instance-unavailable` 实例不可用 | 503 `instance_unavailable`、504 `instance_timeout`、502 `instance_error` | 「查看实例」；全局横幅负责倒计时与自动重试 |
| `needs-configuration` 需要配置 | 结果带 `needsConfiguration` / `missingEnv` | 打开配置表单 |
| `disconnected` 断连 | 网络失败、连接断开 | 恢复后自动重读 |
| `unknown` 结果未知 | 写请求超时或断连 | 只读核对，不重放 |
| `error` 失败 | 其他 | 重试 + 技术详情折叠 |

写法要求：

- 标题说状态（「已锁定」），正文说原因和下一步（「已在适配器层禁用，这一层不能修改」），一到两句，不写「出错了」「未知错误」。
- 原始错误文本只放在「技术详情」折叠里。
- 加载中用骨架（`Skeleton`），不要把「暂无数据」当加载态；读取失败不能显示成空列表。
- 实例不可用时，全局横幅（`InstanceUnavailableBanner`，挂在 shell）显示 Retry-After 倒计时、自动重试与「查看实例」入口，恢复后自动消失。横幅不遮挡页面：访问控制、实例、终端等网关页继续可用。页面自身只需在对应区块显示 `instance-unavailable`，不要整页拦截。

## 10. 亮暗主题

- 颜色只用语义令牌：`foreground` / `muted-foreground` / `card` / `muted` / `primary` / `success` / `warning` / `destructive` / `info`，透明度用 `hsl(var(--token) / 0.1)`。
- 不写死 `#fff`、`black`、`gray-500` 等；阴影用 `--console-shadow-*`。
- 状态色语义不随配色方案变化（`tests/visual-foundation.test.mjs` 保证对比度），新组件不要引入新的状态色。
- 每次改页面都在亮色与暗色下各截一张图检查文字对比、边框可见与徽标可读。

## 11. 文案与国际化

- UI 文案中文为主，所有界面文字走 `i18n.t('…')`；标签表（如页签名、状态文案）写成作者原文常量，渲染时 `i18n.t(label)`。
- 每个新词条在 `console-ui/src/i18n/messages.en*.mjs` 补英文；删掉不再使用的旧词条（`tests/localization.test.mjs` 双向检查）。
- 术语：聊天账号（不是「渠道」「机器人管理」）、适配器、会话、功能、聊天角色（所有者 / 管理员 / 受信任）、范围。

## 12. 组件速查

| 组件 | 位置 | 用途 |
|---|---|---|
| `ObjectPageLayout` / `ObjectSection` / `useScopeTab` | `scope/ObjectPageLayout.tsx` | 对象页框架、页签内区块、读写当前页签 |
| `ScopeBreadcrumb` / `ScopePicker` | `scope/` | 四级面包屑与范围切换 |
| `scope-tree.mjs` | `scope/` | 路由、解析键、面包屑、页签与权限表、选择器模型 |
| `ChatRolesPanel` / `chat-roles-model.mjs` | `scope/` | 角色页签（`chat-roles.list|grant|revoke`） |
| `StatusState` / `status-state-model.mjs` | `components/` | 统一状态与错误解析 |
| `ActionReceipt` / `useActionReceipt` / `action-receipt-model.mjs` | `components/` | 写操作回执 |
| `InstanceUnavailableBanner` / `utils/instance-availability.mjs` | shell | 实例不可用横幅 |
| `scripts/ui-preview-host.mjs` | 本地 | 合成数据的只读 Host，用于截图（`UI_PREVIEW_ORIGIN` 可加允许的来源） |
