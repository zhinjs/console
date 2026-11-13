import { app } from './utils/console-client'
import HomePage from './pages/dashboard'
import AttentionPage from './pages/attention'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import ScopeObjectRoute from './pages/scope'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvManagePage from './pages/env'
import FileManagePage from './pages/files'
import DatabasePage from './pages/database/database-page'
import MarketplacePage from './pages/marketplace'
import TaskHubPage from './pages/task-hub'
import WelcomeUseCasePage from './pages/welcome-use-case'
import IntrospectionPage from './pages/introspection'
import ScenarioLabPage from './pages/scenario-lab'
import CommandPermissionsPage from './pages/command-permissions'
import AgentWorkbenchPage from './pages/agent-workbench'
import PersonalModelsPage from './pages/personal-models'
import AgentSessionsPage from './pages/agent-sessions'
import BotReplayPage from './pages/bot-replay'
import { REPLAY_PERMISSION } from './pages/bot-replay-model.mjs'
import AmbientEngagementPage from './pages/ambient-engagement'
import { AMBIENT_STATUS_PERMISSION } from './pages/ambient-engagement-model.mjs'
import TokenUsagePage from './pages/token-usage'
import SkillsAssistantPage from './pages/skills-assistant'
import { SKILLS_STATUS_PERMISSION } from './pages/skills-assistant-model.mjs'
import WorkroomsPage from './pages/workrooms'
import WorkroomCatalogPage from './pages/workroom-catalog'
import FeatureMatrixPage from './pages/features/feature-matrix'
import GlobalFeatureConfigPage from './pages/features/global-config'
import OnboardingPage from './pages/onboarding'
import AccountPage from './pages/account'
import OpsInstancePage from './pages/ops/instance'
import OpsTerminalPage from './pages/ops/terminal'
import AccessUsersPage from './pages/access/users'
import AccessRolesPage from './pages/access/roles'
import AccessTokensPage from './pages/access/tokens'
import AccessAuditPage from './pages/access/audit'
import { LegacyRedirect } from './components/legacy-redirect'
import { CONSOLE_PATHS as P, LEGACY_ROUTE_REDIRECTS } from './console-routes.mjs'
import { NAV_GROUPS } from './navigation-taxonomy'

let builtinPagesRegistered = false

/**
 * Builtin pages in the ADR 0052 sections. `meta.group` is the section label; the order
 * inside a section follows `meta.order`.
 */
export function registerBuiltinConsolePages() {
  if (builtinPagesRegistered) return
  builtinPagesRegistered = true

  // 概览 — 现在怎么样？
  app.addRoute({ path: P.dashboard, name: '首页', parent: null, icon: 'Home', element: <HomePage />, meta: { group: NAV_GROUPS.OVERVIEW, order: 0 } })
  app.addRoute({ path: P.attention, name: '需要你处理', parent: null, icon: 'Bell', element: <AttentionPage />, meta: { group: NAV_GROUPS.OVERVIEW, order: 0.5 } })
  app.addRoute({ path: P.logs, name: '运行日志', parent: null, icon: 'FileText', element: <LogsPage />, meta: { group: NAV_GROUPS.OVERVIEW, order: 1, fullWidth: true } })
  app.addRoute({ path: P.agentWorkbench, name: '机器人状态', parent: null, icon: 'Brain', element: <AgentWorkbenchPage />, meta: { group: NAV_GROUPS.OVERVIEW, order: 2 } })
  app.addRoute({
    path: P.agentReplay,
    name: '决策回放',
    parent: P.agentWorkbench,
    icon: 'Brain',
    element: <BotReplayPage />,
    requiredPermissions: [REPLAY_PERMISSION],
    meta: { group: NAV_GROUPS.OVERVIEW, order: 2, hideInMenu: true },
  })
  app.addRoute({
    path: P.agentUsage,
    name: 'Token 用量',
    parent: null,
    icon: 'BarChart3',
    element: <TokenUsagePage />,
    requiredPermissions: ['control:read'],
    meta: { group: NAV_GROUPS.OVERVIEW, order: 3 },
  })

  // 会话 — 在和谁说话？对象树 全局 ─ 适配器 ─ 账号 ─ 会话，每级一个对象页（沙盒由插件页面注册，见 PLUGIN_PAGE_PLACEMENT）
  app.addRoute({ path: P.scope, name: '账号与会话', parent: null, icon: 'Bot', element: <ScopeObjectRoute />, meta: { group: NAV_GROUPS.WORK, order: 1 } })
  app.addRoute({ path: P.scopeAdapter, name: '适配器详情', parent: P.scope, element: <ScopeObjectRoute />, meta: { group: NAV_GROUPS.WORK, hideInMenu: true } })
  app.addRoute({ path: P.scopeEndpoint, name: '聊天账号详情', parent: P.scopeAdapter, element: <ScopeObjectRoute />, meta: { group: NAV_GROUPS.WORK, hideInMenu: true, fullWidth: true } })
  app.addRoute({ path: P.scopeConversation, name: '会话详情', parent: P.scopeEndpoint, element: <ScopeObjectRoute />, meta: { group: NAV_GROUPS.WORK, hideInMenu: true, fullWidth: true } })
  app.addRoute({ path: P.agentSessions, name: '聊天记录', parent: null, icon: 'GitBranch', element: <AgentSessionsPage />, meta: { group: NAV_GROUPS.WORK, order: 2 } })

  // 功能 — 机器人能做什么、在哪里做？
  app.addRoute({ path: P.features, name: '功能矩阵', parent: null, icon: 'ToggleLeft', element: <FeatureMatrixPage />, meta: { group: NAV_GROUPS.FEATURES, order: 0, fullWidth: true } })
  app.addRoute({ path: P.featureGlobal, name: '全局配置', parent: P.features, element: <GlobalFeatureConfigPage />, meta: { group: NAV_GROUPS.FEATURES, hideInMenu: true } })
  app.addRoute({ path: P.ai, name: 'AI 与模型', parent: null, icon: 'KeyRound', element: <PersonalModelsPage />, meta: { group: NAV_GROUPS.FEATURES, order: 2 } })
  app.addRoute({
    path: P.aiSkills,
    name: '技能助手',
    parent: null,
    icon: 'Sparkles',
    element: <SkillsAssistantPage />,
    requiredPermissions: [SKILLS_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.FEATURES, order: 3 },
  })
  app.addRoute({
    path: P.aiAmbient,
    name: '群聊插话',
    parent: null,
    icon: 'MessagesSquare',
    element: <AmbientEngagementPage />,
    requiredPermissions: [AMBIENT_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.FEATURES, order: 4 },
  })
  app.addRoute({ path: P.aiWorkrooms, name: 'Workroom', parent: null, icon: 'Workflow', element: <WorkroomsPage />, meta: { group: NAV_GROUPS.FEATURES, order: 5, fullWidth: true } })
  app.addRoute({
    path: P.aiWorkroomCatalog,
    name: 'Workroom 配置',
    parent: P.aiWorkrooms,
    icon: 'Network',
    element: <WorkroomCatalogPage />,
    meta: { group: NAV_GROUPS.FEATURES, order: 5, fullWidth: true, hideInMenu: true },
  })
  app.addRoute({ path: P.introspection, name: '运行时能力', parent: null, icon: 'Blocks', element: <IntrospectionPage />, meta: { group: NAV_GROUPS.FEATURES, order: 6, fullWidth: true } })
  app.addRoute({ path: P.permissions, name: '命令权限说明', parent: P.introspection, icon: 'Shield', element: <CommandPermissionsPage />, meta: { group: NAV_GROUPS.FEATURES, order: 6, hideInMenu: true } })
  app.addRoute({ path: P.scenarioLab, name: '消息场景试验台', parent: null, icon: 'FlaskConical', element: <ScenarioLabPage />, meta: { group: NAV_GROUPS.FEATURES, order: 7, fullWidth: true } })
  app.addRoute({ path: P.groupWelcome, name: '群欢迎配置流程', parent: P.features, element: <WelcomeUseCasePage />, meta: { hideInMenu: true, group: NAV_GROUPS.FEATURES } })

  // 插件 — 装了什么？
  app.addRoute({ path: P.plugins, name: '插件', parent: null, icon: 'Package', element: <PluginsPage />, meta: { group: NAV_GROUPS.PLUGINS, order: 0 } })
  app.addRoute({ path: P.pluginDetail, name: '插件详情', parent: P.plugins, element: <PluginDetailPage />, meta: { hideInMenu: true, group: NAV_GROUPS.PLUGINS } })
  app.addRoute({ path: P.marketplace, name: '插件市场', parent: null, icon: 'Store', element: <MarketplacePage />, meta: { group: NAV_GROUPS.PLUGINS, order: 1 } })

  // 运维 — 宿主机怎么样？（实例：ADR 0054；终端：ADR 0051）
  app.addRoute({ path: P.opsInstance, name: '实例', parent: null, icon: 'Server', element: <OpsInstancePage />, meta: { group: NAV_GROUPS.OPS, order: -1 } })
  app.addRoute({ path: P.opsDatabase, name: '数据库', parent: null, icon: 'Database', element: <DatabasePage />, meta: { group: NAV_GROUPS.OPS, order: 0, fullWidth: true } })
  app.addRoute({ path: P.opsConfig, name: '配置文件', parent: null, icon: 'Settings', element: <ConfigPage />, meta: { group: NAV_GROUPS.OPS, order: 1 } })
  app.addRoute({ path: P.opsEnv, name: '环境变量', parent: null, icon: 'KeyRound', element: <EnvManagePage />, meta: { group: NAV_GROUPS.OPS, order: 2 } })
  app.addRoute({ path: P.opsSchedules, name: '定时任务', parent: null, icon: 'ClipboardList', element: <TaskHubPage />, meta: { group: NAV_GROUPS.OPS, order: 3 } })
  app.addRoute({ path: P.opsFiles, name: '项目文件', parent: null, icon: 'FolderOpen', element: <FileManagePage />, meta: { group: NAV_GROUPS.OPS, order: 4 } })
  app.addRoute({ path: P.opsTerminal, name: '终端', parent: null, icon: 'Terminal', element: <OpsTerminalPage />, meta: { group: NAV_GROUPS.OPS, order: 5, fullWidth: true } })

  // 访问控制 — 谁能做什么？（ADR 0049）
  app.addRoute({ path: P.accessUsers, name: '用户', parent: null, icon: 'Users', element: <AccessUsersPage />, meta: { group: NAV_GROUPS.ACCESS, order: 0 } })
  app.addRoute({ path: P.accessRoles, name: '角色', parent: null, icon: 'Shield', element: <AccessRolesPage />, meta: { group: NAV_GROUPS.ACCESS, order: 1 } })
  app.addRoute({ path: P.accessTokens, name: 'API 令牌', parent: null, icon: 'KeyRound', element: <AccessTokensPage />, meta: { group: NAV_GROUPS.ACCESS, order: 2 } })
  app.addRoute({ path: P.accessAudit, name: '审计日志', parent: null, icon: 'Activity', element: <AccessAuditPage />, meta: { group: NAV_GROUPS.ACCESS, order: 3, fullWidth: true } })

  // 个人：引导（ADR 0053）与个人设置（ADR 0049），不在菜单里，从横幅与顶栏进入。
  app.addRoute({ path: P.onboarding, name: '开始使用', parent: null, icon: 'Rocket', element: <OnboardingPage />, meta: { group: NAV_GROUPS.OVERVIEW, hideInMenu: true } })
  app.addRoute({ path: P.account, name: '个人设置', parent: null, icon: 'UserRound', element: <AccountPage />, meta: { group: NAV_GROUPS.OVERVIEW, hideInMenu: true } })

  // Old routes stay as hidden redirects (ADR 0052 迁移).
  for (const [path, rule] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
    app.addRoute({ path, name: path, parent: rule.to, element: <LegacyRedirect />, meta: { hideInMenu: true } })
  }
}
