import { app } from '@zhin.js/client'
import HomePage from './pages/dashboard'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import BotManagePage from './pages/bots'
import BotDetailPage from './pages/bot-detail'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvManagePage from './pages/env'
import FileManagePage from './pages/files'
import DatabasePage from './pages/database/database-page'
import CronPage from './pages/cron'
import MarketplacePage from './pages/marketplace'
import IntrospectionPage from './pages/introspection'
import AgentSessionsPage from './pages/agent-sessions'

export function registerBuiltinConsolePages() {
  app.addRoute({
    path: '/dashboard',
    name: '概览',
    parent: null,
    icon: 'Home',
    element: <HomePage />,
    meta: { group: '系统', order: 0 },
  })

  app.addRoute({
    path: '/logs',
    name: '日志',
    parent: null,
    icon: 'FileText',
    element: <LogsPage />,
    meta: { group: '系统', order: 1, fullWidth: true },
  })

  app.addRoute({
    path: '/cron',
    name: '定时任务',
    parent: null,
    icon: 'Clock',
    element: <CronPage />,
    meta: { group: '系统', order: 2 },
  })

  app.addRoute({
    path: '/bots',
    name: '机器人',
    parent: null,
    icon: 'Bot',
    element: <BotManagePage />,
    meta: { group: '机器人', order: 0 },
  })

  app.addRoute({
    path: '/introspection',
    name: '命令与工具',
    parent: null,
    icon: 'Terminal',
    element: <IntrospectionPage />,
    meta: { group: '命令与 Agent', order: 0, fullWidth: true },
  })

  app.addRoute({
    path: '/agent/sessions',
    name: '对话分支',
    parent: null,
    icon: 'GitBranch',
    element: <AgentSessionsPage />,
    meta: { group: '命令与 Agent', order: 1 },
  })

  app.addRoute({
    path: '/plugins',
    name: '插件',
    parent: null,
    icon: 'Package',
    element: <PluginsPage />,
    meta: { group: '扩展', order: 0 },
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
    meta: { group: '扩展', order: 1 },
  })

  app.addRoute({
    path: '/config',
    name: '配置',
    parent: null,
    icon: 'Settings',
    element: <ConfigPage />,
    meta: { group: '配置与数据', order: 0 },
  })

  app.addRoute({
    path: '/env',
    name: '环境变量',
    parent: null,
    icon: 'KeyRound',
    element: <EnvManagePage />,
    meta: { group: '配置与数据', order: 1 },
  })

  app.addRoute({
    path: '/files',
    name: '项目文件',
    parent: null,
    icon: 'FolderOpen',
    element: <FileManagePage />,
    meta: { group: '配置与数据', order: 2 },
  })

  app.addRoute({
    path: '/database',
    name: '数据库',
    parent: null,
    icon: 'Database',
    element: <DatabasePage />,
    meta: { group: '配置与数据', order: 3, fullWidth: true },
  })

  app.addRoute({
    path: '/bots/:adapter/:botId',
    name: '机器人详情',
    parent: null,
    element: <BotDetailPage />,
    meta: { hideInMenu: true, fullWidth: true },
  })
}
