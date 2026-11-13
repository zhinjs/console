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

## 2. 外壳、布局栅格与断点

外壳（`layouts/dashboard.tsx` + `shell.css`）：灰色画布上方悬浮一条胶囊导航栏（距顶 12px、高 60px，半透明白底 + 背景模糊，页面滚动后底色加深），内容是居中的单列，最宽 1440px（`--console-content-max`），左右留 `--console-space-page-x`。整页随窗口滚动，导航栏固定；吸顶元素与锚点跳转都要让出导航栏高度（`--console-header-h`，`html` 上设了 `scroll-padding-top`）。

导航栏从左到右：品牌 → 六个区（日常、管理两组，中间一条竖线）→ 快速跳转（Ctrl/⌘ K）、底部日志面板（Ctrl `）、实时连接状态点、语言、外观、个人设置、退出。

- 只有一个页面的区是直接链接（显示页面名），有多个页面的区是下拉菜单（显示区名，当前页在其中时按钮高亮）。导航模型只有一个：`buildNavigation(routes, access)`，不要在别处另排菜单。
- 宽度不到 1100px（`useIsCompactNav`）时，区不再放在栏里，改由左上角菜单按钮打开左侧抽屉：抽屉按 日常 / 管理 → 区 → 页面列出全部页面；关闭时 `inert`，打开时页面与导航栏 `inert`，Esc（先让开 Radix 弹层自己的 Esc）或点遮罩关闭，焦点回到菜单按钮。
- **底部日志面板**（`components/log-panel/`，外壳挂一次）是全局浮层里唯一的非模态面板：任何页面都能打开它看实时日志，不打断手上的事。
  - 入口：顶栏图标按钮（`aria-expanded` / `aria-controls`）、快捷键 Ctrl `（两个平台都用 Ctrl：⌘` 是 macOS 切换窗口；不与 Ctrl/⌘ K 冲突，快速跳转的动作与页脚写明了它）、快速跳转的「打开日志面板」，以及页面里的 `openLogPanel({ q, adapter, endpoint, level })`（`useLogPanel()` 同时给出 `available`）。页面里「去日志页看看」的链接，只要留在当前页更好（正在扫码登录、填写配置、只存在内存里的确认记录），就改成打开面板并带上筛选；没有面板时保留原来的 `/logs?q=` 链接。
  - 内容是与 `/logs` 相同的 `LogViewer`（`pages/logs/LogViewer.tsx`）：筛选由外部控制（`params` + `onParamsChange`）。`/logs` 传地址栏的参数，面板传自己的状态（`log-panel-store.mjs`），**绝不改当前页面的地址**；面板标题栏的「在日志页打开」带着同一组筛选去 `/logs`。上次的筛选与高度记在 localStorage（读写都 try/catch，读不到用默认值）。
  - 面板用紧凑排版（`pages/logs/LogPanelWorkbench.tsx`，`/logs` 页仍是 `LogWorkbench`）：范围只在标题栏显示为一个标签（标识 + 「打开对象页」图标 + 清除），按文本匹配的说明放在标签的提示里，不再显示范围条；一行工具栏（搜索、级别、跟随最新、刷新 / 来源 / 更多三个图标按钮，每页条数与日志维护在「更多」里）；每条日志一行约 28px（等宽时间 · 级别图标 · 来源 · 截断的消息，完整消息在提示里，点击或回车在旁边打开事件详情）；没有「历史事件」区块标题，条数与翻页在一行约 32px 的页脚。默认 360px 高时 1440 宽下至少显示 8 行。
  - 宽屏：停靠在底部、占满内容宽度，**非模态**——没有遮罩，页面不 `inert`，没有焦点陷阱；页面底部让出面板高度（`--console-log-panel-reserve`，toast 也随之上移），最后几行照样能滚到。上边缘拖动条 `role="separator"` 可拖、可用 ↑ / ↓（Shift 加大步长）/ Home / End 调整，180px 到视口 80%。打开时焦点移进面板，关闭时回到打开它的控件（用户已把焦点移到页面别处时不抢）；Esc 只在焦点位于面板内、且没有内层弹层先消费时关闭。
  - 手机（<768px）：模态底部抽屉，遮罩 + 页面与导航栏 `inert`，没有拖动条。`prefers-reduced-motion` 下不做滑入动画。
  - 只对能看 `/logs` 的身份出现（`ROUTE_PERMISSIONS['/logs']`，即 `status.view`）：按钮、快捷键、快速跳转动作与页面里的「查看日志」一起隐藏。只在打开时挂载 `LogViewer`，关闭即停止轮询；在 `/logs` 页上面板不显示（按钮禁用），两个查看器不会同时轮询同一个接口，离开 `/logs` 后面板回来。标签页隐藏时轮询跳过请求。
- `fullWidth` 路由（日志、数据库、终端、对象树的账号与会话层等）内容不受 1440px 限制，导航栏跟着放宽，两侧边缘对齐。
- 换页时内容 200ms 淡入并上移 8px（`--console-ease-out`，`prefers-reduced-motion` 下关闭）；只改查询参数（页签、筛选）不触发动画，也不回到顶部。

| 断点 | 宽度 | 布局 |
|---|---|---|
| 手机 | 320–767px | 单列；控件高度 44px；页头动作占满一行；页签横向滚动，不换行；详情用底部抽屉（`Sheet side="bottom"`）；导航栏只留菜单、品牌标志、搜索图标与账号操作 |
| 平板 / 窄笔记本 | 768–1099px | 单列内容区；导航在抽屉里，栏内保留完整搜索框 |
| 笔记本 | 1100–1439px | 导航栏放下六个区；品牌文字与搜索提示文字收起，只留图标与快捷键 |
| 宽屏 | ≥1440px | 有 `aside`（下级对象列表）时两列：`18rem` 侧列 + 内容，侧列 `sticky`（让出导航栏高度） |

- 移动端路径是「列表 → 内容 → 详情」：在上级对象页的列表里点对象进入它的页面（内容），对象内的单条明细用抽屉打开（详情），返回靠浏览器后退或面包屑，不在同一屏同时摆三栏。
- 所有页面在 320px 宽下不得出现横向滚动条（表格放进 `Card overflow-hidden`，宽表格在小屏改为卡片或只保留关键列）。
- 截图验收：1440、768 与 375 三个宽度 × 亮暗两种主题。

## 3. 令牌、间距与字号

只用设计令牌，不写死颜色和像素字号。令牌分三层：

- **基础**（`design-system.css`，不分亮暗）：圆角 6 / 10 / 14 / 18 / 22px（`--console-radius-sm|md|lg|xl|2xl`）；控件高度三档 32 / 36 / 40px（`--console-control-height-sm|…|-lg`，手机统一 44px）；字体 Inter / MiSans，代码 JetBrains Mono（只用本机已有字体，不请求远程字体）；页面边距、区块间距；内容宽 1440px；动效时长与曲线。
- **语义**（`theme-tokens.css`，分亮暗）：画布 `background`（浅灰）、卡片 `card`（白）、卡片内分组 `secondary` / `muted`（更浅的灰，不描边）、文字 `foreground` / `muted-foreground`、强调 `primary`、柔和主操作 `primary-action`（色相的浅色填充）+ `primary-action-foreground`（色相文字）+ `primary-action-border`、状态色与图表色。阴影 `--console-shadow-*`：一圈发丝描边加一层短而柔的投影。
- **组件**（写在组件旁边）：导航栏 `--console-header-h`、`--console-nav-*`（`shell.css`）等。

- 卡片 `Card` / `console-card`：白底、无边框、`--console-shadow-sm`，圆角 18px；卡片里的分组块用浅灰填充，不再描边、不再加阴影。可点击卡片悬停时阴影加深、上移 1px。
- 按钮：主按钮是浅色强调填充 + 强调色描边与文字（不是实心色块）；次要按钮 `outline` 白底细边；`ghost` 只在悬停时出现浅灰底；危险操作仍用实心 `destructive`。
- 区块间距：页面内区块之间 `var(--console-space-section)`；页头与页签之间 `1rem`（手机 `0.75rem`）；同一区块内元素 `0.75rem`；行内控件 `0.5rem`。
- 卡片内边距：`p-4`（16px），紧凑表格行为表格默认值。
- 字号角色：页标题 `console-page-title`（22px、600），区块标题 `console-section-title`，正文 `--console-text-body`，辅助说明 `--console-text-body-sm` + `muted-foreground`，标签与徽标 `--console-text-caption`。徽标不小于 12px。
- 身份（适配器别名、账号 ID、会话 ID、范围键）用等宽字体 `code`，超长截断并保留 `title`。

## 4. 页头

对象页的页头由 `ObjectPageLayout` 统一渲染，页面不要再放 `PageHeader` 或「返回」按钮：

1. 面包屑 `ScopeBreadcrumb`：每一级带层级名（适配器 / 账号 / 群聊…），祖先可点；全局页不显示。
2. 标题行：图标、显示名（没有就用 ID）、层级徽标、平台徽标、状态徽标（在线 / 离线 / 有覆盖 / 已锁定）。
3. 一句话说明（这一页能做什么）。
4. 完整身份 `qq / bot-1 / group:123`，旁边复制按钮复制 Host 范围键。
5. 右侧动作：页面自己的动作（刷新、打开聊天）+ 固定的「切换范围」`ScopePicker`。切换范围只改变查看对象，不授予权限，选择器底部写明这一点。

非对象页（运维、访问控制等）继续用 `PageShell` + `PageHeader`，标题与说明的写法相同；这些页的面包屑（区 › 页面）由外壳画在页头上方，页面不要自己再放。

## 5. 页签

- 页签由层级决定（`SCOPE_TABS`），页面只提供各页签的内容 `panels`；不要在页签内容里再套一层 Tabs 作为主导航。
- 当前页签写在 `?tab=`，切换用 `replace`，不产生历史记录；无效值回到概览。
- 无权限的页签仍然显示（带锁图标），内容是 `StatusState kind="forbidden"` 并列出需要的权限（`SCOPE_TAB_PERMISSIONS`）。不要悄悄隐藏。
- 只挂载当前页签，离开即卸载；需要保留草稿的页签自己用未保存修改守卫。页签里的写操作回执给 `useActionReceipt({ persistKey })`（范围 + 动作，如 `feature:adapter:qq:ai`），回执存在模块级 store（`components/action-receipt-store.mjs`），切走页签时请求照样落到回执里，切回来恢复「提交中 / 结果未知」，不会重新放开按钮；`submit` / `verify` 从 `plan.payload` 读要写什么，不读组件 ref。
- 页签权限在本对象上检查（`scopeTabAllowed`）：适配器 / 账号级绑定（`/auth/me` 的 `bindings`，只含 `CONSOLE_SCOPED_PERMISSIONS`）在其下的对象有效，会话算作它的账号；页内按钮用 `hasConsolePermission(name, access, scopePermissionTarget(scope))`。
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
- **结果未知**（超时、断连、读不出的答复、网关 504 `instance_timeout` / 502 `instance_error` 且 `requestOutcome: 'unknown'`）：只提供「核对当前状态」（`verify`，只读重新读取），绝不自动或手动重放写操作。回执不能关闭、取消，也不能被新的 `prepare` 覆盖；核对确认已生效 → 成功，确认未生效 → 未执行，用户点「放弃并重新开始」才回到空闲。
- 页面的写按钮统一用 `receiptBlocksActions(receipt.state)` 判定忙碌（待确认、提交中、核对中、结果未知都算），不要自己枚举阶段。
- 危险操作的「确认执行」把「取消」放在前面并聚焦，且出现后 `CONFIRM_GUARD_MS`（400ms）内忽略确认，双击或连按回车不会越过二次确认。
- 已发布 SDK 的 `sendRequest` 丢掉 Host 的 `code`、`requestOutcome`、`lockedBy` 与 `Retry-After`，并把超时、断网、非 JSON 答复都报成 `MessageError('REST request failed')`；`requestConsole` 经 `utils/rpc-reply-capture.mjs` 记录答复，把这些放回 `error.details`。
- **未执行**（Host 明确拒绝：权限、校验、冲突、锁定，或 503 `instance_unavailable` 的 `not-dispatched`）：显示原因，可以重新准备。
- **网关事务**（插件全局启停 `feature.set-enabled` `level: 'global'` / `plugin:set-enabled`，需要 `plugin.manage`；停止实例 → 写入 `disable_plugins` → 启动，失败回滚）：经 `use-global-plugin-switch.ts` 用 `apiFetch` 发送，不受 SDK 10 秒超时限制。500 `transaction_failed` = 未执行（已自动回滚），500 `rollback_failed` = 失败、回滚未完成（链到「实例」页），`gateway-required`（`--standalone`）= 说明用 `zhin start` 或 `zhin enable / zhin disable`；`statusFromError` 读成 `kind: 'error'` + `transaction`，`failedPhase` 与 `logTail` 放在「技术详情」里。
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

## 10. 亮暗主题与配色

- 颜色只用语义令牌：`foreground` / `muted-foreground` / `card` / `secondary` / `muted` / `primary` / `primary-action` / `success` / `warning` / `destructive` / `info`，透明度用 `hsl(var(--token) / 0.1)`。
- 不写死 `#fff`、`black`、`gray-500` 等；阴影用 `--console-shadow-*`。
- 八种配色（外观面板）只改变色相：画布与卡片保持中性（只带一点色相），色相用在链接、焦点、选中态与柔和主操作上。默认配色是「海蓝」（蓝色强调）。
- 状态色与图表色不随配色变化（`tests/visual-foundation.test.mjs` 保证对比度与中性表面），新组件不要引入新的状态色。
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
| `LogPanel` / `LogPanelButton` / `useLogPanel` / `openLogPanel` | `components/log-panel/` | 底部日志面板（shell）；`LogViewer`（`pages/logs/`）是它与 `/logs` 共用的查看器 |
| `useAttention` / `attention-model.mjs` / `AttentionBadge` | `pages/attention/` | 「需要你处理」：`attention.list` 的共享读取（30 秒、聚焦与推送事件防抖刷新；旧 Host 回退到 Console 推断），本浏览器内的「稍后提醒」/「忽略」，首页区块、`/attention` 页与顶栏角标共用 |
| `scripts/ui-preview-host.mjs` | 本地 | 合成数据的只读 Host，用于截图（`UI_PREVIEW_ORIGIN` 可加允许的来源；`UI_PREVIEW_ATTENTION=empty` / `legacy` 模拟没有待办 / 旧 Host） |
