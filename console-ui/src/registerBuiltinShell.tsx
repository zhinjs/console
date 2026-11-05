import { app } from '@zhin.js/client'
import HomePage from './pages/dashboard'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import EndpointsPage from './pages/endpoints'
import EndpointDetailPage from './pages/endpoint-detail'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvManagePage from './pages/env'
import FileManagePage from './pages/files'
import DatabasePage from './pages/database/database-page'
import MarketplacePage from './pages/marketplace'
import TaskHubPage, { LegacyTaskRoute } from './pages/task-hub'
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
import { NAV_GROUPS } from './navigation-taxonomy'

let builtinPagesRegistered = false

export function registerBuiltinConsolePages() {
  if (builtinPagesRegistered) return
  builtinPagesRegistered = true

  app.addRoute({
    path: '/dashboard',
    name: '首页',
    parent: null,
    icon: 'Home',
    element: <HomePage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 0 },
  })

  app.addRoute({
    path: '/logs',
    name: '运行日志',
    parent: null,
    icon: 'FileText',
    element: <LogsPage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 2, fullWidth: true },
  })

  app.addRoute({
    path: '/tasks',
    name: '任务',
    parent: null,
    icon: 'ClipboardList',
    element: <TaskHubPage />,
    meta: { group: NAV_GROUPS.TASKS, order: 0 },
  })

  app.addRoute({
    path: '/use-cases/group-welcome',
    name: '群欢迎配置流程',
    parent: '/tasks',
    element: <WelcomeUseCasePage />,
    meta: { hideInMenu: true, group: NAV_GROUPS.TASKS },
  })

  // Legacy entries: kept as hidden redirects so bookmarks and old links land on the matching /tasks tab.
  app.addRoute({
    path: '/cron',
    name: '定时提醒',
    parent: '/tasks',
    element: <LegacyTaskRoute />,
    meta: { group: NAV_GROUPS.TASKS, hideInMenu: true },
  })

  app.addRoute({
    path: '/assistant/jobs',
    name: '助手任务',
    parent: '/tasks',
    element: <LegacyTaskRoute />,
    meta: { group: NAV_GROUPS.TASKS, hideInMenu: true },
  })

  app.addRoute({
    path: '/endpoints',
    name: '聊天账号',
    parent: null,
    icon: 'Bot',
    element: <EndpointsPage />,
    meta: { group: NAV_GROUPS.ACCOUNTS, order: 0 },
  })

  app.addRoute({
    path: '/agent/workbench',
    name: '机器人状态',
    parent: null,
    icon: 'Brain',
    element: <AgentWorkbenchPage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 1 },
  })

  app.addRoute({
    path: '/agent/replay',
    name: '决策回放',
    parent: '/agent/workbench',
    icon: 'Brain',
    element: <BotReplayPage />,
    requiredPermissions: [REPLAY_PERMISSION],
    meta: { group: NAV_GROUPS.OPERATIONS, order: 1, hideInMenu: true },
  })

  app.addRoute({
    path: '/agent/ambient',
    name: '群聊插话',
    parent: null,
    icon: 'MessagesSquare',
    element: <AmbientEngagementPage />,
    requiredPermissions: [AMBIENT_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.SETTINGS, order: 2 },
  })

  app.addRoute({
    path: '/agent/skills',
    name: '技能助手',
    parent: null,
    icon: 'Sparkles',
    element: <SkillsAssistantPage />,
    requiredPermissions: [SKILLS_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.SETTINGS, order: 3 },
  })

  app.addRoute({
    path: '/agent/usage',
    name: 'Token 用量',
    parent: null,
    icon: 'BarChart3',
    element: <TokenUsagePage />,
    requiredPermissions: ['control:read'],
    meta: { group: NAV_GROUPS.OPERATIONS, order: 3 },
  })

  app.addRoute({
    path: '/agent/workrooms',
    name: 'Workroom',
    parent: null,
    icon: 'Workflow',
    element: <WorkroomsPage />,
    meta: { group: NAV_GROUPS.TASKS, order: 2, fullWidth: true },
  })

  app.addRoute({
    path: '/agent/workrooms/catalog',
    name: 'Workroom 配置',
    parent: '/agent/workrooms',
    icon: 'Network',
    element: <WorkroomCatalogPage />,
    meta: { group: NAV_GROUPS.TASKS, order: 2, fullWidth: true, hideInMenu: true },
  })

  app.addRoute({ path: '/scenario-lab', name: '消息场景试验台', parent: null, icon: 'FlaskConical', element: <ScenarioLabPage />, meta: { group: NAV_GROUPS.OPERATIONS, order: 7, fullWidth: true } })

  app.addRoute({
    path: '/introspection',
    name: '运行时能力',
    parent: null,
    icon: 'Blocks',
    element: <IntrospectionPage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 4, fullWidth: true },
  })

  app.addRoute({
    path: '/permissions',
    name: '命令权限说明',
    parent: '/introspection',
    icon: 'Shield',
    element: <CommandPermissionsPage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 4, hideInMenu: true },
  })

  app.addRoute({ path: '/agent/models', name: '模型', parent: null, icon: 'KeyRound', element: <PersonalModelsPage />, meta: { group: NAV_GROUPS.SETTINGS, order: 4 } })

  app.addRoute({
    path: '/agent/sessions',
    name: '聊天记录',
    parent: null,
    icon: 'GitBranch',
    element: <AgentSessionsPage />,
    meta: { group: NAV_GROUPS.WORK, order: 1 },
  })

  app.addRoute({
    path: '/plugins',
    name: '插件管理',
    parent: null,
    icon: 'Package',
    element: <PluginsPage />,
    meta: { group: NAV_GROUPS.PLUGINS, order: 0 },
  })

  app.addRoute({
    path: '/plugins/:name',
    name: '插件详情',
    parent: '/plugins',
    element: <PluginDetailPage />,
    meta: { hideInMenu: true, group: NAV_GROUPS.PLUGINS },
  })

  app.addRoute({
    path: '/marketplace',
    name: '插件市场',
    parent: null,
    icon: 'Store',
    element: <MarketplacePage />,
    meta: { group: NAV_GROUPS.PLUGINS, order: 1 },
  })

  app.addRoute({
    path: '/config',
    name: '设置',
    parent: null,
    icon: 'Settings',
    element: <ConfigPage />,
    meta: { group: NAV_GROUPS.SETTINGS, order: 0 },
  })

  app.addRoute({
    path: '/env',
    name: '环境变量',
    parent: null,
    icon: 'KeyRound',
    element: <EnvManagePage />,
    meta: { group: NAV_GROUPS.SETTINGS, order: 1 },
  })

  app.addRoute({
    path: '/files',
    name: '项目文件',
    parent: null,
    icon: 'FolderOpen',
    element: <FileManagePage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 5 },
  })

  app.addRoute({
    path: '/database',
    name: '数据库',
    parent: null,
    icon: 'Database',
    element: <DatabasePage />,
    meta: { group: NAV_GROUPS.OPERATIONS, order: 6, fullWidth: true },
  })

  app.addRoute({
    path: '/endpoints/:adapter/:endpointId',
    name: '聊天账号详情',
    parent: '/endpoints',
    element: <EndpointDetailPage />,
    meta: { hideInMenu: true, fullWidth: true, group: NAV_GROUPS.ACCOUNTS },
  })
}
