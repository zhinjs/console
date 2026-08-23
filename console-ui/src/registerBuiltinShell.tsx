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
import IntrospectionPage from './pages/introspection'
import AgentWorkbenchPage from './pages/agent-workbench'
import AgentSessionsPage from './pages/agent-sessions'
import WorkroomsPage from './pages/workrooms'
import WorkroomCatalogPage from './pages/workroom-catalog'
import { NAV_GROUPS } from './navigation-taxonomy'

let builtinPagesRegistered = false

export function registerBuiltinConsolePages() {
  if (builtinPagesRegistered) return
  builtinPagesRegistered = true

  app.addRoute({
    path: '/dashboard',
    name: '工作台',
    parent: null,
    icon: 'Home',
    element: <HomePage />,
    meta: { group: NAV_GROUPS.OVERVIEW, order: 0 },
  })

  app.addRoute({
    path: '/logs',
    name: '日志',
    parent: null,
    icon: 'FileText',
    element: <LogsPage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 1, fullWidth: true },
  })

  app.addRoute({
    path: '/cron',
    name: '定时任务',
    parent: null,
    icon: 'Clock',
    element: <CronPage />,
    meta: { group: NAV_GROUPS.AUTOMATION, order: 0 },
  })

  app.addRoute({
    path: '/endpoints',
    name: '渠道与会话',
    parent: null,
    icon: 'Bot',
    element: <EndpointsPage />,
    meta: { group: NAV_GROUPS.CONVERSATIONS, order: 0 },
  })

  app.addRoute({
    path: '/agent/workbench',
    name: 'Agent 概览',
    parent: null,
    icon: 'Brain',
    element: <AgentWorkbenchPage />,
    meta: { group: NAV_GROUPS.AGENTS, order: 0 },
  })

  app.addRoute({
    path: '/agent/workrooms',
    name: 'Workroom',
    parent: null,
    icon: 'Workflow',
    element: <WorkroomsPage />,
    meta: { group: NAV_GROUPS.AGENTS, order: 1, fullWidth: true },
  })

  app.addRoute({
    path: '/agent/workrooms/catalog',
    name: 'Workroom 配置',
    parent: null,
    icon: 'Network',
    element: <WorkroomCatalogPage />,
    meta: { group: NAV_GROUPS.AGENTS, order: 2, fullWidth: true, hideInMenu: true },
  })

  app.addRoute({
    path: '/introspection',
    name: '运行时能力',
    parent: null,
    icon: 'Blocks',
    element: <IntrospectionPage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 0, fullWidth: true },
  })

  app.addRoute({
    path: '/agent/sessions',
    name: 'Agent Sessions',
    parent: null,
    icon: 'GitBranch',
    element: <AgentSessionsPage />,
    meta: { group: NAV_GROUPS.AGENTS, order: 2 },
  })

  app.addRoute({
    path: '/plugins',
    name: '插件',
    parent: null,
    icon: 'Package',
    element: <PluginsPage />,
    meta: { group: NAV_GROUPS.AUTOMATION, order: 1 },
  })

  app.addRoute({
    path: '/plugins/:name',
    name: '插件详情',
    parent: null,
    element: <PluginDetailPage />,
    meta: { hideInMenu: true },
  })

  app.addRoute({
    path: '/marketplace',
    name: '市场',
    parent: null,
    icon: 'Store',
    element: <MarketplacePage />,
    meta: { group: NAV_GROUPS.AUTOMATION, order: 2 },
  })

  app.addRoute({
    path: '/config',
    name: '配置',
    parent: null,
    icon: 'Settings',
    element: <ConfigPage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 2 },
  })

  app.addRoute({
    path: '/env',
    name: '环境变量',
    parent: null,
    icon: 'KeyRound',
    element: <EnvManagePage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 3 },
  })

  app.addRoute({
    path: '/files',
    name: '项目文件',
    parent: null,
    icon: 'FolderOpen',
    element: <FileManagePage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 4 },
  })

  app.addRoute({
    path: '/database',
    name: '数据库',
    parent: null,
    icon: 'Database',
    element: <DatabasePage />,
    meta: { group: NAV_GROUPS.SYSTEM, order: 5, fullWidth: true },
  })

  app.addRoute({
    path: '/endpoints/:adapter/:endpointId',
    name: 'Endpoint 详情',
    parent: null,
    element: <EndpointDetailPage />,
    meta: { hideInMenu: true, fullWidth: true },
  })
}
