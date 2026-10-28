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
import CronPage from './pages/cron'
import MarketplacePage from './pages/marketplace'
import TaskCenterPage from './pages/task-center'
import WelcomeUseCasePage from './pages/welcome-use-case'
import IntrospectionPage from './pages/introspection'
import ScenarioLabPage from './pages/scenario-lab'
import CommandPermissionsPage from './pages/command-permissions'
import AgentWorkbenchPage from './pages/agent-workbench'
import AgentSessionsPage from './pages/agent-sessions'
import BotReplayPage from './pages/bot-replay'
import { REPLAY_PERMISSION } from './pages/bot-replay-model.mjs'
import AmbientEngagementPage from './pages/ambient-engagement'
import { AMBIENT_STATUS_PERMISSION } from './pages/ambient-engagement-model.mjs'
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
    meta: { group: NAV_GROUPS.DAILY, order: 0 },
  })

  app.addRoute({
    path: '/logs',
    name: '运行记录',
    parent: null,
    icon: 'FileText',
    element: <LogsPage />,
    meta: { group: NAV_GROUPS.DAILY, order: 4, fullWidth: true },
  })

  app.addRoute({
    path: '/tasks',
    name: '任务中心',
    parent: null,
    icon: 'ClipboardList',
    element: <TaskCenterPage />,
    meta: { group: NAV_GROUPS.FEATURES, order: 2 },
  })

  app.addRoute({
    path: '/use-cases/group-welcome',
    name: '群欢迎配置流程',
    parent: '/tasks',
    element: <WelcomeUseCasePage />,
    meta: { hideInMenu: true, group: NAV_GROUPS.FEATURES },
  })

  app.addRoute({
    path: '/cron',
    name: '定时提醒',
    parent: null,
    icon: 'Clock',
    element: <CronPage />,
    meta: { group: NAV_GROUPS.DAILY, order: 3 },
  })

  app.addRoute({
    path: '/endpoints',
    name: '聊天账号',
    parent: null,
    icon: 'Bot',
    element: <EndpointsPage />,
    meta: { group: NAV_GROUPS.DAILY, order: 1 },
  })

  app.addRoute({
    path: '/agent/workbench',
    name: '机器人状态',
    parent: null,
    icon: 'Brain',
    element: <AgentWorkbenchPage />,
    meta: { group: NAV_GROUPS.BOT, order: 0 },
  })

  app.addRoute({
    path: '/agent/replay',
    name: '决策回放',
    parent: '/agent/workbench',
    icon: 'Brain',
    element: <BotReplayPage />,
    requiredPermissions: [REPLAY_PERMISSION],
    meta: { group: NAV_GROUPS.BOT, order: 1, hideInMenu: true },
  })

  app.addRoute({
    path: '/agent/ambient',
    name: '群聊插话',
    parent: null,
    icon: 'MessagesSquare',
    element: <AmbientEngagementPage />,
    requiredPermissions: [AMBIENT_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.BOT, order: 3 },
  })

  app.addRoute({
    path: '/agent/skills',
    name: '技能助手',
    parent: null,
    icon: 'Sparkles',
    element: <SkillsAssistantPage />,
    requiredPermissions: [SKILLS_STATUS_PERMISSION],
    meta: { group: NAV_GROUPS.BOT, order: 4 },
  })

  app.addRoute({
    path: '/agent/workrooms',
    name: 'Workroom',
    parent: null,
    icon: 'Workflow',
    element: <WorkroomsPage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 6, fullWidth: true },
  })

  app.addRoute({
    path: '/agent/workrooms/catalog',
    name: 'Workroom 配置',
    parent: '/agent/workrooms',
    icon: 'Network',
    element: <WorkroomCatalogPage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 7, fullWidth: true, hideInMenu: true },
  })

  app.addRoute({ path: '/scenario-lab', name: '消息场景试验台', parent: null, icon: 'FlaskConical', element: <ScenarioLabPage />, meta: { group: NAV_GROUPS.ADVANCED, order: 5, fullWidth: true } })

  app.addRoute({
    path: '/introspection',
    name: '运行时能力',
    parent: null,
    icon: 'Blocks',
    element: <IntrospectionPage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 4, fullWidth: true },
  })

  app.addRoute({
    path: '/permissions',
    name: '命令权限说明',
    parent: '/introspection',
    icon: 'Shield',
    element: <CommandPermissionsPage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 8, hideInMenu: true },
  })

  app.addRoute({
    path: '/agent/sessions',
    name: '聊天记录',
    parent: null,
    icon: 'GitBranch',
    element: <AgentSessionsPage />,
    meta: { group: NAV_GROUPS.DAILY, order: 2 },
  })

  app.addRoute({
    path: '/plugins',
    name: '功能管理',
    parent: null,
    icon: 'Package',
    element: <PluginsPage />,
    meta: { group: NAV_GROUPS.FEATURES, order: 0 },
  })

  app.addRoute({
    path: '/plugins/:name',
    name: '插件详情',
    parent: '/plugins',
    element: <PluginDetailPage />,
    meta: { hideInMenu: true, group: NAV_GROUPS.FEATURES },
  })

  app.addRoute({
    path: '/marketplace',
    name: '功能商店',
    parent: null,
    icon: 'Store',
    element: <MarketplacePage />,
    meta: { group: NAV_GROUPS.FEATURES, order: 1 },
  })

  app.addRoute({
    path: '/config',
    name: '设置',
    parent: null,
    icon: 'Settings',
    element: <ConfigPage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 0 },
  })

  app.addRoute({
    path: '/env',
    name: '环境变量',
    parent: null,
    icon: 'KeyRound',
    element: <EnvManagePage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 1 },
  })

  app.addRoute({
    path: '/files',
    name: '项目文件',
    parent: null,
    icon: 'FolderOpen',
    element: <FileManagePage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 2 },
  })

  app.addRoute({
    path: '/database',
    name: '数据库',
    parent: null,
    icon: 'Database',
    element: <DatabasePage />,
    meta: { group: NAV_GROUPS.ADVANCED, order: 3, fullWidth: true },
  })

  app.addRoute({
    path: '/endpoints/:adapter/:endpointId',
    name: '渠道详情',
    parent: '/endpoints',
    element: <EndpointDetailPage />,
    meta: { hideInMenu: true, fullWidth: true, group: NAV_GROUPS.DAILY },
  })
}
