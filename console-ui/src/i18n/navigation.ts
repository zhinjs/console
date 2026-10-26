import { translate, type Locale } from './locale.mjs'
import type { ConsoleRouteRecord } from '@zhin.js/client'

// Only the shell-owned path/name pair is translated. Plugin route titles remain authored by their provider.
const builtinNames: Readonly<Record<string, string>> = {
  "/dashboard": "首页",
  "/logs": "运行记录",
  "/tasks": "任务中心",
  "/use-cases/group-welcome": "群欢迎配置流程",
  "/cron": "定时提醒",
  "/endpoints": "聊天账号",
  "/agent/workbench": "机器人状态",
  "/agent/ambient": "群聊插话",
  "/agent/workrooms": "Workroom",
  "/agent/workrooms/catalog": "Workroom 配置",
  "/scenario-lab": "消息场景试验台",
  "/introspection": "运行时能力",
  "/permissions": "命令权限说明",
  "/agent/sessions": "聊天记录",
  "/plugins": "功能管理",
  "/plugins/:name": "插件详情",
  "/marketplace": "功能商店",
  "/config": "配置",
  "/env": "环境变量",
  "/files": "项目文件",
  "/database": "数据库",
  "/endpoints/:adapter/:endpointId": "渠道详情",
  "/assistant/jobs": "助手任务"
}

export function routeLabel(route: ConsoleRouteRecord, locale: Locale): string {
  return builtinNames[route.path] === route.name ? translate(locale, route.name) : route.name
}
