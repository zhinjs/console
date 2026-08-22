import {
  ENDPOINT_RPC,
  INBOX_RPC,
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
} from '@zhin.js/contract'

/**
 * Console 只面向当前 Zhin 协议。
 *
 * Endpoint / Inbox 名称来自共享 contract；其余 RPC 与 REST 路径在这里集中声明，
 * 页面不得自行拼写旧别名或尝试新旧接口回退。
 */
export { ENDPOINT_RPC, INBOX_RPC, SIDE_EVENT_PUSH, SIDE_EVENT_RPC }

export const CONSOLE_RPC = {
  SYSTEM_RESTART: 'system:restart',
  SCHEDULE_LIST: 'schedule:list',
  CRON_ADD: 'cron:add',
  CRON_REMOVE: 'cron:remove',
  CRON_PAUSE: 'cron:pause',
  CRON_RESUME: 'cron:resume',
} as const

export const CONSOLE_REST = {
  SYSTEM_STATUS: '/api/system/status',
  STATS: '/api/stats',
  LOGS_STATS: '/api/logs/stats',
  LOGS: '/api/logs',
  LOGS_CLEANUP: '/api/logs/cleanup',
  INTROSPECTION: '/api/introspection',
  AGENT_SESSIONS: '/api/agent/sessions',
  WORKROOM_RUNS: '/api/agent/workroom/runs',
} as const

export type SupportedIntrospectionKind =
  | 'commands'
  | 'endpoints'
  | 'bindings'
  | 'tools'
  | 'mcp'
