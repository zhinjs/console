import { translate, type Locale } from './locale.mjs'
import type { ConsoleRouteRecord } from '@zhin.js/client'

// Plugin titles use only explicit provider metadata; shell-owned path/name pairs use our catalog.
const builtinNames: Readonly<Record<string, string>> = {
  "/dashboard": "首页",
  "/attention": "需要你处理",
  "/logs": "运行日志",
  "/agent/workbench": "机器人状态",
  "/agent/replay": "决策回放",
  "/agent/usage": "Token 用量",
  "/scope": "账号与会话",
  "/scope/:adapter": "适配器详情",
  "/scope/:adapter/:endpoint": "聊天账号详情",
  "/scope/:adapter/:endpoint/:conversation": "会话详情",
  "/agent/sessions": "聊天记录",
  "/features": "功能矩阵",
  "/features/global/:plugin": "全局配置",
  "/features/ai": "AI 与模型",
  "/features/ai/skills": "技能助手",
  "/features/ai/ambient": "群聊插话",
  "/features/ai/workrooms": "Workroom",
  "/features/ai/workrooms/catalog": "Workroom 配置",
  "/introspection": "运行时能力",
  "/permissions": "命令权限说明",
  "/scenario-lab": "消息场景试验台",
  "/use-cases/group-welcome": "群欢迎配置流程",
  "/plugins": "插件",
  "/plugins/:name": "插件详情",
  "/marketplace": "插件市场",
  "/ops/database": "数据库",
  "/ops/config": "配置文件",
  "/ops/env": "环境变量",
  "/ops/schedules": "定时任务",
  "/ops/files": "项目文件",
  "/ops/instance": "实例",
  "/ops/terminal": "终端",
  "/onboarding": "开始使用",
  "/account": "个人设置",
  "/access/users": "用户",
  "/access/roles": "角色",
  "/access/tokens": "API 令牌",
  "/access/audit": "审计日志",
}

export function routeLabel(route: ConsoleRouteRecord, locale: Locale): string {
  // Keep compatibility with older published client types while the optional metadata rolls out.
  const titles = (route.meta as { readonly titleI18n?: Readonly<Partial<Record<Locale, string>>> } | undefined)?.titleI18n
  const provided = titles && Object.hasOwn(titles, locale) ? titles[locale] : undefined
  if (typeof provided === 'string' && provided.trim()) return provided
  return builtinNames[route.path] === route.name ? translate(locale, route.name) : route.name
}
