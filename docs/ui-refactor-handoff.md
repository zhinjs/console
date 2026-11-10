# UI 重构续接摘要

更新：2026-11-09（远端核对）。来源会话：适配器界面设计重构（local_ec77cefc-317c-4648-9654-0116dc916c1e）。

## 阅读范围与证据边界

本次读取原会话最近 380 条消息及此前 200 条消息；此前 200 条转录共 1195 行，已由只读子代理按序完整读取。没有读取原会话全部 1951 条消息。以下区分旧会话报告和当前代码核对，不能把旧测试通过当作当前验证。

## 已定方向

- 旧会话沿用轻量黑白灰，彩色集中在主要操作和语义状态；提升操作流程，不只换配色。
- 用户最后明确要求停止处理已由他人负责的 zhinjs/zhin#1131，继续优化 UI，参考 https://github.com/SuInk/Diana 的交互；不复制其代码或素材。
- 最后一轮的具体实施目标：聊天账号快速切换、聊天时便于收起主导航、附件操作收进清楚的菜单。该轮停在浏览器验收阶段，不能认定已经验收完成。
- 自动修复最后被用户取消；本次没有自动修复、自动合并、提交或推送授权。

## 历史完成情况（旧会话报告）

- 适配器登录与状态、账号配置、Sandbox 会话、Bilibili 评论审核以及 Console 轻量视觉和手机布局已经过一轮重构。
- Console PR https://github.com/zhinjs/console/pull/50 在旧会话后续消息中显示已合并；Zhin PR https://github.com/zhinjs/zhin/pull/1132 当时保留 Draft。当前远端状态仍须另行核对。
- 旧会话报告 Console 638 项、适配器 242 项、agent eval 196 项通过；Zhin 全量串行检查仍有临时目录 ENOTEMPTY 清理错误，RSS 超时单独复验通过。
- 所有浏览器证据使用本地模拟数据，未验证真实平台收发。

## 当前工作区核对

- Zhin：`/Users/liuchunlang/IdeaProjects/zhin`，分支 `fix/deep-audit-bugs-and-architecture`。启动时的未提交快照已过期；核对时工作区干净，最新提交为 `bc6ccb1ea`，此前 `fa3b6c5a3` 已提交七项架构改进。它不是本轮 Console UI 的续做目标。
- 用户提供 Console 工作区：`/Users/liuchunlang/IdeaProjects/console-ui-polish`，分支 `polish/c1-console`，核对时干净，HEAD `abb797a`。此分支另有 dashboard/token/marketplace 修复和任务中心合并，不要覆盖。
- Console 已有主导航折叠、手机 drawer inert/Escape/焦点恢复、命令跳转以及对应 `tests/workspace-navigation.test.mjs`。继续在这些现有实现上做增量，不重写导航。
- 聊天页：`console-ui/src/pages/endpoint-detail/index.tsx`；公共布局：`console-ui/src/layouts/dashboard.tsx`；聊天共享样式：`console-ui/src/im-workspace.css`。
- 本地模拟 Host：`scripts/ui-preview-host.mjs`，默认 18087，合成令牌 `ui-preview`，不连接真实 Host/平台/模型。

## 续做与验收

1. 按当前分支补齐聊天页账号切换及附件菜单，保留会话发送、引用、编辑、草稿和只读约束。
2. 为切换/菜单补回归测试，检查离线状态、当前账号及键盘操作。
3. 用 preview 工具启动当前工作区的 Console + 本地 fixture；桌面/手机、菜单 Escape/焦点恢复、账号跳转、附件选择、消息草稿验收。
4. 跑 Console test/typecheck/build；明确区分模拟数据 UI 验收和真实收发。

## 2026-11-09 远端核对（优先于前面的历史状态）

两仓库均已成功 `fetch origin main`。用户随后明确授权“保留并同步”：Zhin 已快进到 `5cd5c4965`；Console 通过合并提交 `897f172` 纳入 `origin/main@b3806f1`。8 个冲突已解决，本轮 5 个 tracked 与 4 个 untracked 文件已校验恢复，并仍未提交；不使用 stash/reset，没有推送。

- Console `origin/main`：`b3806f1`，现已是 `polish/c1-console@897f172` 的祖先。同步前 main 有 6 个本地缺失提交、本地有 20 个 main 未直接包含的提交；采用 merge 保留提交历史，未 reset。
- 已合并的近期 UI 工作：https://github.com/zhinjs/console/pull/58 （组件画廊实时属性与画布调试）、https://github.com/zhinjs/console/pull/59 （交互工作台、平台账号与登录中心）、https://github.com/zhinjs/console/pull/60 （Diana 风格主从布局、事件流、平台选择弹窗、18px/12px 圆角）。模型管理与页面组织也已变化，不能按旧会话重新实现。
- main 新增 `@zhin.js/client-sdk`（映射 `@zhin.js/client@^1.1.30`），新增 `/assets/client`、`/esm`、`/console/api` 开发代理；应在同步后重装声明依赖并重新验收。
- main 与本地 HEAD 的 `endpoint-detail/index.tsx`、`ConversationSidebar.tsx`、`im-workspace.css` 三个文件完全相同；main 尚无本轮新增的 `AccountSwitcher.tsx` 与 `ComposerAttachmentMenu.tsx`。因此这两项不是当前 main 已做的重复功能，但必须接到新 UI 和 SDK 环境中验证。
- Zhin 当前 main 与远端一致，均为 `5cd5c4965`，工作区干净。近期已合并 https://github.com/zhinjs/zhin/pull/1212 （Diana 组织）、https://github.com/zhinjs/zhin/pull/1209 （插件交互工作台），此前架构重构不能当仍待实现。

## 本轮本地改动与验证

- 新增账号菜单：按 Host/令牌作用域读取账号目录，当前账号和离线状态可见，失败有重试；有文字、附件、引用或未完成媒体 URL 时，切换需确认。
- 新增附件菜单：保留本地图片、本地文件、图片/视频/音频链接五个入口，发送期间禁用；账号路由切换重挂载聊天工作区，避免附件或引用跨账号残留。
- 新增 `tests/workspace-chat-controls.test.mjs` 9 项回归，并更新抽屉测试的组件 mock。
- 合并最新 main 并完成手机交互修复后：**759/759 项测试通过、typecheck 通过、生产 build 通过**；`git diff --check` 通过。
- 生产浏览器已验证：在线/离线账号菜单和实际路由切换；取消离开保留草稿；附件五种入口及图片 URL 插入；375px 手机无横向溢出、附件按钮 44px；Escape 关闭附件菜单并恢复触发按钮焦点。
- 手机验收发现账号菜单与草稿确认框叠加，现已修复：先关闭账号菜单和会话抽屉，抑制菜单抢焦点，确认框保持顶层与焦点；取消后草稿仍保留。相关回归已加入现有测试。
- 浏览器仅连接 `scripts/ui-preview-host.mjs` 的本地合成数据，没有真实平台收发或模型调用。fixture 未覆盖的后台 RPC 会返回 503，因此不将后台服务/整站健康当作已验收。
- 生产预览与 fixture 验收后停止；启动配置在 Zhin `.claude/launch.json`，名称 `console-polish-production` / `console-polish-fixture`。不再使用旧目录 `/Users/liuchunlang/IdeaProjects/console` 的预览配置。
- 改动均未提交。用户已授权同步；8 个合并冲突按新版页面组织和 inference 契约解决，保留自动合并的本地部分。旧 `use-personal-models.ts` 已无调用且依赖被主分支删除，作为迁移收尾移除。本轮 UI 改动保持 unstaged，不纳入同步合并提交。
