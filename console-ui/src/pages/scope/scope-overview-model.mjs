/**
 * 概览 / 接入 tabs of the object pages: pure summaries of `endpoint.list`, `login.list` and
 * `feature.conversations` rows. The pages render them; nothing here talks to the Host.
 */

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)

const adapterOf = endpoint => endpoint?.endpoint?.adapter ?? endpoint?.adapter

/**
 * One entry per adapter alias: accounts the Host runs (`endpoint.list`), how many are online, open
 * requests / notices, login tasks waiting, and accounts the Host only knows from configuration or
 * stored overrides (`feature.matrix` `endpoints`). Sorted by alias.
 */
export function adapterOverview(endpoints = [], { tasks = [], known = {} } = {}) {
  const byAdapter = new Map()
  const entry = adapter => {
    if (!byAdapter.has(adapter)) byAdapter.set(adapter, { adapter, accounts: 0, online: 0, pending: 0, waitingLogin: 0, configuredOnly: [] })
    return byAdapter.get(adapter)
  }
  const running = new Set()
  for (const endpoint of endpoints) {
    const adapter = adapterOf(endpoint)
    if (typeof adapter !== 'string' || !adapter) continue
    const item = entry(adapter)
    running.add(`${adapter}\u0000${endpoint.name}`)
    item.accounts += 1
    if (endpoint.connected === true) item.online += 1
    item.pending += (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
  }
  for (const task of tasks) {
    if (task && typeof task.adapter === 'string' && task.adapter) entry(task.adapter).waitingLogin += 1
  }
  for (const [adapter, ids] of Object.entries(isRecord(known) ? known : {})) {
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      if (typeof id === 'string' && id && !running.has(`${adapter}\u0000${id}`)) entry(adapter).configuredOnly.push(id)
    }
  }
  return [...byAdapter.values()].map(item => ({ ...item, configuredOnly: [...new Set(item.configuredOnly)].sort() }))
    .sort((a, b) => a.adapter.localeCompare(b.adapter))
}

/** Totals across adapters (概览 facts of 全局). */
export function overviewTotals(adapters) {
  return adapters.reduce((sum, item) => ({
    adapters: sum.adapters + 1,
    accounts: sum.accounts + item.accounts,
    online: sum.online + item.online,
    pending: sum.pending + item.pending,
    waitingLogin: sum.waitingLogin + item.waitingLogin,
  }), { adapters: 0, accounts: 0, online: 0, pending: 0, waitingLogin: 0 })
}

/** Login tasks (`login.list`) of one account, or of one adapter when `endpoint` is omitted. */
export function loginTasksFor(tasks = [], adapter, endpoint) {
  return tasks.filter(task => task && task.adapter === adapter && (endpoint === undefined || task.endpointKey === endpoint))
}

export const ACCOUNT_FILTERS = Object.freeze(['all', 'online', 'waiting', 'offline'])
export const ACCOUNT_FILTER_LABELS = Object.freeze({ all: '全部', online: '在线', waiting: '等待登录', offline: '离线' })

function waitingLogin(endpoint, tasks) {
  return endpoint.pendingLogin === true || tasks.some(task => task.adapter === endpoint.adapter && task.endpointKey === endpoint.name)
}

/** Status of one account row: online / waiting (login task open) / offline. */
export function accountStatus(endpoint, tasks = []) {
  if (endpoint?.connected === true) return 'online'
  return waitingLogin(endpoint, tasks) ? 'waiting' : 'offline'
}

/** Accounts that pass a status filter and a name / adapter search, sorted by adapter then name. */
export function filterAccounts(endpoints = [], { filter = 'all', query = '', tasks = [] } = {}) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return endpoints.filter(endpoint => {
    if (filter !== 'all' && accountStatus(endpoint, tasks) !== filter) return false
    return !text || `${endpoint.name} ${endpoint.adapter}`.toLowerCase().includes(text)
  }).sort((a, b) => a.adapter.localeCompare(b.adapter) || a.name.localeCompare(b.name))
}

/** Counts for the account filter buttons. */
export function accountCounts(endpoints = [], tasks = []) {
  const counts = { all: endpoints.length, online: 0, waiting: 0, offline: 0 }
  for (const endpoint of endpoints) counts[accountStatus(endpoint, tasks)] += 1
  return counts
}

/**
 * What the 接入 tab of one account can show: `loading` until `endpoint.list` answered once,
 * `failed` when it never did, `listed` with the row, or `unlisted` when the Host does not run the
 * account right now (removed from configuration, not started, or its adapter is down). An unlisted
 * account is not "no accounts at all".
 */
export function endpointAccessState({ loaded = false, error = null, endpoints = [] } = {}, adapter, endpoint) {
  const row = endpoints.find(item => adapterOf(item) === adapter && item.name === endpoint)
  if (row) return { kind: 'listed', endpoint: row, siblings: endpoints.filter(item => adapterOf(item) === adapter).length }
  if (!loaded) return error ? { kind: 'failed', error } : { kind: 'loading' }
  return { kind: 'unlisted', siblings: endpoints.filter(item => adapterOf(item) === adapter).length }
}

/**
 * The few conversations an account's 概览 shows (the full list lives in its 聊天 tab): those with
 * overrides first, then the most recently active ones without, each capped at `limit`.
 */
export function conversationHighlights(items = [], limit = 5) {
  const overridden = items.filter(item => item.hasOverrides)
    .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)).slice(0, limit)
  const recent = items.filter(item => !item.hasOverrides && typeof item.lastActiveAt === 'number')
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, limit)
  return { overridden, recent, total: items.length }
}

/**
 * Platforms offered by 「接入新平台账号」: where each one is configured. Adapter Console pages
 * live at the adapter's plugin route; the rest go to plugins / the marketplace.
 */
export const ONBOARDING_PLATFORMS = Object.freeze([
  { id: 'icqq', title: 'ICQQ (QQ个人号)', badge: '扫码 / 滑块验证', desc: '接入个人 QQ 账号，支持群管、私聊、二维码扫码与滑块票据辅助登录。', to: '/icqq' },
  { id: 'qq', title: 'QQ 官方机器人', badge: '官方 API', desc: '通过 QQ 开放平台 AppID 与 Secret 接入官方频道与群聊机器人。', to: '/qq' },
  { id: 'onebot11', title: 'NapCat / OneBot 11', badge: 'WebSocket', desc: '通过正向或反向 WebSocket 连接 NapCat、Lagrange 等 OneBot v11 协议端。', to: '/onebot11' },
  { id: 'telegram', title: 'Telegram', badge: 'Bot Token', desc: '使用 BotFather 签发的 Token 接入 Telegram 私聊、群组与内联按钮。', to: '/telegram' },
  { id: 'discord', title: 'Discord', badge: 'Gateway / Slash', desc: '接入 Discord 服务器频道、私信会话与机器人交互组件。', to: '/discord' },
  { id: 'enterprise', title: '飞书 / 钉钉 / 企微', badge: '企业办公 IM', desc: '前往插件配置页启用飞书 Lark、钉钉 DingTalk 或企业微信适配器。', to: '/plugins' },
  { id: 'email', title: 'Email 邮件', badge: 'IMAP / SMTP', desc: '配置邮箱收发通道，让机器人通过邮件接收指令与发送通知。', to: '/email' },
  { id: 'marketplace', title: '探索更多平台适配器', badge: '插件市场', desc: '浏览 KOOK、Slack、LINE、GitHub、Satori 等更多社区与官方适配器。', to: '/marketplace' },
].map(item => Object.freeze(item)))

/** Display label of an adapter type (`@zhin.js/adapter-icqq` → `ICQQ 协议端`); unknown ones stay as given. */
export function platformLabel(adapter) {
  const key = String(adapter ?? '').trim().toLowerCase().replace(/^@zhin\.js\//u, '').replace(/^adapter-/u, '')
  return PLATFORM_LABELS[key] ?? adapter
}

const PLATFORM_LABELS = Object.freeze({
  icqq: 'ICQQ 协议端', qq: 'QQ 官方机器人', napcat: 'NapCat', onebot11: 'OneBot 11', 'onebot-11': 'OneBot 11', onebot12: 'OneBot 12', 'onebot-12': 'OneBot 12',
  telegram: 'Telegram', discord: 'Discord', lark: '飞书 Lark', feishu: '飞书 Lark', dingtalk: '钉钉 DingTalk', wecom: '企业微信', 'work-weixin': '企业微信',
  slack: 'Slack', kook: 'KOOK', line: 'LINE', email: 'Email', github: 'GitHub', sandbox: 'Sandbox',
})

/**
 * 群聊插话设置 for a group conversation, preselected by query (the ambient page reads `adapter`,
 * `endpoint` and `conversation`, the latter `<kind>:<id>` URI-encoded like the object-tree segment).
 * Null for private chats and channels.
 */
export function ambientSettingsHref(scope) {
  if (!scope || scope.kind !== 'group' || !scope.adapter || !scope.endpoint || !scope.id) return null
  const segment = value => encodeURIComponent(String(value))
  return `/agent/ambient?adapter=${segment(scope.adapter)}&endpoint=${segment(scope.endpoint)}&conversation=${segment(`group:${scope.id}`)}`
}
