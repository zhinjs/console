#!/usr/bin/env node
/** Loopback-only, in-memory UI fixture. It never connects to a real Host, platform, model, or database. */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? process.env.UI_PREVIEW_PORT ?? 18087)
const origins = new Set(['http://localhost:9000', 'http://127.0.0.1:9000', 'http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.UI_PREVIEW_ORIGIN ? [process.env.UI_PREVIEW_ORIGIN] : [])])
const endpoints = [
  { name: 'preview-community', adapter: 'icqq', connected: true, status: 'online', transportState: 'open', phase: 'ready', endpoint: { adapter: 'icqq', id: 'preview-community' }, managementCapabilities: ['listFriends', 'listGroups', 'listChannels', 'listGroupMembers'], pendingRequestCount: 0, pendingNoticeCount: 0 },
  { name: 'preview-support', adapter: 'telegram', connected: false, status: 'offline', transportState: 'stopped', phase: 'stopped', endpoint: { adapter: 'telegram', id: 'preview-support' }, managementCapabilities: [], pendingRequestCount: 0, pendingNoticeCount: 0 },
]
const logs = [
  { id: 3, timestamp: Date.now() - 20_000, level: 'info', name: 'preview', plugin: 'preview', message: '这是本地界面预览，不连接真实平台。' },
  { id: 2, timestamp: Date.now() - 40_000, level: 'warn', name: 'preview', plugin: 'preview', message: '客服账号尚未启动。请在账号页检查状态。' },
  { id: 1, timestamp: Date.now() - 60_000, level: 'info', name: 'preview', plugin: 'preview', message: '会话目录已加载。' },
]
const engagement = {
  summary: { engagementId: 'preview-engagement-1', venue: 'preview-room', status: 'completed', startedAt: Date.now() - 300_000, endedAt: Date.now() - 296_000,
    eventCount: 5, hops: 2, turns: 3, tokensUsed: 1840, wallClockMs: 4200, participants: ['agent:planner', 'agent:reviewer'], stopReason: 'done' },
  events: [
    { kind: 'engagement.started', initiator: { kind: 'human', principalId: 'preview-user' }, venue: 'preview-room' },
    { kind: 'mail.sent', envelope: { from: { kind: 'agent', name: 'planner' }, to: { kind: 'agent', name: 'reviewer' }, kind: 'request' } },
    { kind: 'board.updated', entry: { key: 'plan', version: 2, updatedBy: { kind: 'agent', name: 'planner' } } },
    { kind: 'budget.recorded', hops: 2, turns: 3, tokensUsed: 1840 },
    { kind: 'engagement.stopped', status: 'completed', reason: 'done' },
  ],
  board: [{ key: 'plan', value: { steps: ['draft', 'review'] }, version: 2, updatedBy: { kind: 'agent', name: 'planner' }, updatedAt: Date.now() - 297_000 }],
}
const venues = [{ key: 'preview-room', channel: { endpoint: { adapter: 'icqq', id: 'preview-community' }, kind: 'group', id: '20001' }, floor: 'moderated' }]
const envelope = data => ({ success: true, data })
// Chat fixtures (聊天 / 记录 tabs): several senders in one group, a private chat, members, sessions.
const MINUTE = 60_000
const chatHistory = {
  'group:20001': [
    { sender: { id: '10001', name: '演示同事' }, at: 26 * 60 * MINUTE, direction: 'inbound', text: '昨天的版本已经合并了，今天上午开始灰度。' },
    { sender: { id: '10002', name: '测试同学' }, at: 25.9 * 60 * MINUTE, direction: 'inbound', text: '收到，我先看一下监控。' },
    { sender: { id: '10001', name: '演示同事' }, at: 14 * MINUTE, direction: 'inbound', text: '今天的发布准备完成了吗？' },
    { sender: { id: '10001', name: '演示同事' }, at: 13 * MINUTE, direction: 'inbound', text: '我想确认一下机器人账号和任务的运行情况。' },
    { sender: { id: 'self', name: 'Zhin' }, at: 12 * MINUTE, direction: 'outbound', text: '账号已连接，定时任务在 10:00 正常执行过一次。' },
    { sender: { id: 'self', name: 'Zhin' }, at: 11.5 * MINUTE, direction: 'outbound', text: '运行记录也已检查，没有失败的回合。' },
    { sender: { id: '10002', name: '测试同学' }, at: 4 * MINUTE, direction: 'inbound', text: '好的，那我这边开始回归。有问题在群里说。' },
  ],
  'private:10001': [
    { sender: { id: '10001', name: '演示用户' }, at: 30 * MINUTE, direction: 'inbound', text: '你好，帮我看看今天的提醒有没有发出去？' },
    { sender: { id: 'self', name: 'Zhin' }, at: 29 * MINUTE, direction: 'outbound', text: '已发送：今天 9:00 的站会提醒。' },
  ],
}
const groupMembers = [
  { user_id: 10000, nickname: '群主小王', role: 'owner' },
  { user_id: 10001, nickname: '演示同事', role: 'admin' },
  { user_id: 10002, nickname: '测试同学', role: 'member' },
  { user_id: 10005, nickname: '新同学', role: 'member' },
]
const traceSessions = [
  { session_key: 'icqq:preview-community:group:20001', turns: 18, last_started_at: Date.now() - 12 * MINUTE, last_status: 'completed' },
  { session_key: 'icqq:preview-community:private:10001', turns: 4, last_started_at: Date.now() - 29 * MINUTE, last_status: 'failed' },
  { session_key: 'telegram:preview-support:private:777', turns: 2, last_started_at: Date.now() - 26 * 60 * MINUTE, last_status: 'completed' },
]
let sentCount = 0
// One clock for every chat fixture, so repeated reads (list, previews, history) agree on timestamps.
const CHAT_NOW = Date.now()
// Object tree fixtures (feature.* ADR 0050 / 0055, chat-roles.* ADR 0056).
const LEVELS = ['global', 'adapter', 'endpoint', 'conversation']
const features = [
  { plugin: 'welcome', displayName: '群欢迎', levels: LEVELS, hasSchema: true, globalEnabled: true, conversationFields: ['text'] },
  { plugin: 'repeater', displayName: '复读机', levels: LEVELS, hasSchema: false, globalEnabled: true },
  { plugin: 'rss', displayName: '订阅推送', levels: ['global', 'adapter', 'endpoint'], hasSchema: true, globalEnabled: false },
]
const conversations = [
  { key: 'icqq/preview-community/group:20001', name: '产品试验群', hasOverrides: true, overrides: [{ plugin: 'welcome', fields: ['text'], updatedAt: Date.now() - 3_600_000 }], lastActiveAt: Date.now() - 60_000 },
  { key: 'icqq/preview-community/private:10001', name: '演示用户', hasOverrides: false, overrides: [], lastActiveAt: Date.now() - 120_000 },
  { key: 'icqq/preview-community/group:a%2Fb', name: '带斜杠的群 a/b', hasOverrides: true, overrides: [{ plugin: 'repeater', enabled: false, fields: [] }] },
]
const chatRoles = [
  { level: 'global', key: '', adapter: 'icqq', userId: '10000', role: 'owner', source: 'config', detail: 'ai.trigger.masters' },
  { level: 'adapter', key: 'icqq', adapter: 'icqq', userId: '10002', role: 'admin', source: 'grant', grantedBy: 'console:owner', grantedAt: Date.now() - 86_400_000 },
  { level: 'endpoint', key: 'icqq/preview-community', adapter: 'icqq', userId: '10003', role: 'trusted', source: 'grant', grantedBy: 'console:owner', grantedAt: Date.now() - 7_200_000 },
  { level: 'conversation', key: 'icqq/preview-community/group:20001', adapter: 'icqq', userId: '10004', role: 'admin', source: 'mapping', detail: 'standing: owner' },
]
const chain = key => {
  const parts = key ? key.split('/') : []
  return ['', parts[0], parts.slice(0, 2).join('/'), parts.length > 2 ? key : undefined].filter((value, index) => index === 0 || (value && index <= parts.length))
}
function featureDetail(body) {
  const feature = features.find(item => item.plugin === body.plugin) ?? features[0]
  const schema = feature.hasSchema ? { type: 'object', properties: { text: { type: 'string', title: '欢迎语', default: '欢迎新朋友' } } } : null
  const overridden = body.level === 'conversation' && body.key === 'icqq/preview-community/group:20001'
  return { revision: 'preview-1', plugin: feature.plugin, level: body.level, key: body.key ?? '', levels: feature.levels, schema,
    values: overridden ? { text: '欢迎来到产品试验群' } : {}, effective: { text: overridden ? '欢迎来到产品试验群' : '欢迎新朋友' },
    sources: { text: overridden ? 'conversation' : 'global' }, enabled: feature.globalEnabled, ...(feature.globalEnabled ? {} : { lockedBy: 'global' }) }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin
  if (origin && origins.has(origin)) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('vary', 'Origin')
    response.setHeader('access-control-allow-headers', 'authorization, content-type')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  }
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const json = (data, status = 200) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)) }
  if (url.pathname === '/pub/health' || url.pathname === '/') { json({ status: 'ok', fixture: 'Local UI preview; synthetic data only' }); return }
  if (request.headers.authorization !== 'Bearer ui-preview' && url.searchParams.get('token') !== 'ui-preview') {
    json({ success: false, error: 'Use the synthetic preview token: ui-preview' }, 401); return
  }
  if (url.pathname === '/api/events/history') { json(envelope({ items: [], hasMore: false, nextAfter: 0, runtimeId: 'ui-preview', latestEventId: 0, oldestAvailableEventId: 0, gap: false })); return }
  if (url.pathname === '/api/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    response.write(': local UI fixture\n\n')
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
    request.on('close', () => clearInterval(heartbeat)); return
  }
  if (url.pathname === '/entries') { json([]); return }
  if (url.pathname === '/api/system/status') {
    json(envelope({ uptime: 3812, platform: 'darwin', nodeVersion: 'v24.19.0', memory: { rss: 64_000_000, heapTotal: 32_000_000, heapUsed: 24_000_000, external: 0 }, cpu: { user: 0, system: 0 }, scope: 'full' })); return
  }
  if (url.pathname === '/api/stats') { json(envelope({ plugins: { total: 3, active: 2 }, endpoints: { total: 2, online: 1 }, commands: 12, uptime: 3812, memory: 64_000_000 })); return }
  if (url.pathname === '/api/logs/stats') { json(envelope({ total: 3, byLevel: { trace: 0, debug: 0, info: 2, warn: 1, error: 0, fatal: 0 }, levels: { info: 2, warn: 1, error: 0 }, oldest: logs[2].timestamp, newest: logs[0].timestamp })); return }
  if (url.pathname === '/api/logs') { json(envelope({ logs, total: logs.length, page: 1, pageSize: 50, hasMore: false })); return }
  if (url.pathname === '/api/plugins') {
    json(envelope(features.map(item => ({ name: item.plugin, description: item.displayName, status: item.globalEnabled ? 'active' : 'inactive', features: [], config: { hasSchema: item.hasSchema } }))))
    return
  }
  if (url.pathname.startsWith('/api/introspection/')) { json(envelope({ items: [], total: 0, page: 1, pageSize: 20 })); return }
  if (url.pathname === '/api/agent/sessions') { json(envelope({ sessions: [], total: 0, items: [] })); return }
  if (url.pathname === '/api/agent/trace-archive/sessions') { json(envelope(traceSessions)); return }
  if (url.pathname === '/console/api/pages') { json({ pages: [] }); return }
  if (url.pathname === '/api/console/request' && request.method === 'POST') {
    let raw = ''
    for await (const chunk of request) {
      raw += chunk
      if (raw.length > 64_000) { json({ success: false, error: 'Preview request is too large' }, 413); return }
    }
    let body
    try { body = JSON.parse(raw) } catch { json({ success: false, error: 'Invalid JSON' }, 400); return }
    const type = String(body.type)
    const endpoint = endpoints.find(endpoint => endpoint.name === (body.endpointKey ?? body.endpointId ?? body.data?.endpointKey)) ?? endpoints[0]
    if (type === 'endpoint.list') { json(envelope({ endpoints })); return }
    if (type === 'feature.list') { json(envelope({ revision: 'preview-1', features })); return }
    if (type === 'feature.get') { json(envelope(featureDetail(body))); return }
    if (type === 'feature.matrix') {
      json(envelope({ revision: 'preview-1', adapters: ['icqq', 'telegram'], endpoints: { icqq: ['preview-community'], telegram: ['preview-support'] },
        conversationOverrides: { icqq: { 'preview-community': 2 } },
        rows: features.map(item => ({ plugin: item.plugin, displayName: item.displayName, global: { enabled: item.globalEnabled, overridden: false },
          adapters: { icqq: { enabled: item.globalEnabled, overridden: item.plugin === 'welcome', ...(item.globalEnabled ? {} : { lockedBy: 'global' }) }, telegram: { enabled: item.globalEnabled, overridden: false, ...(item.globalEnabled ? {} : { lockedBy: 'global' }) } } })) }))
      return
    }
    if (type === 'feature.conversations') {
      const query = typeof body.query === 'string' ? body.query.toLowerCase() : ''
      const items = conversations.filter(item => (!body.adapter || item.key.startsWith(`${body.adapter}/`)) && (!body.endpoint || item.key.startsWith(`${body.adapter}/${body.endpoint}/`))
        && (!query || item.key.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)))
      json(envelope({ conversations: items, recentAvailable: true })); return
    }
    if (type === 'chat-roles.list') {
      const keys = chain(body.key ?? '')
      json(envelope({ roles: chatRoles.filter(entry => keys.includes(entry.key)) })); return
    }
    if (type === 'gateway.instance.status') { json(envelope({ instanceId: 'preview', state: 'running', lastExitCode: null, lastExitSignal: null, recentRestarts: 0 })); return }
    if (type === 'agent.engagements.list') { json(envelope({ engagements: [engagement.summary] })); return }
    if (type === 'agent.engagements.get') {
      if (body.engagementId === engagement.summary.engagementId) json(envelope(engagement))
      else json({ success: false, error: 'Engagement 不存在' }, 404)
      return
    }
    if (type === 'agent.venues.list') { json(envelope({ venues })); return }
    if (type === 'endpoint.info' || type === 'endpoint.get') { json(envelope(endpoint)); return }
    if (type === 'endpoint.test') { json(envelope({ reachable: true, connected: true, latencyMs: 24, message: '本地预览连接正常' })); return }
    if (type === 'endpoint.friends') { json(envelope({ friends: [{ user_id: 10001, nickname: '演示用户', remark: '界面测试' }] })); return }
    if (type === 'endpoint.groups') { json(envelope({ groups: [{ group_id: 20001, name: '产品试验群' }, { group_id: 20002, name: '运维值班群' }] })); return }
    if (type === 'endpoint.channels') { json(envelope({ channels: [] })); return }
    if (type === 'endpoint.group_members' || type === 'endpoint.groupMembers') { json(envelope({ members: groupMembers })); return }
    // Synthetic send receipts for screenshots: text with #ok "succeeds", #timeout is a gateway timeout, anything else is refused.
    if (type === 'endpoint.send_message') {
      const text = JSON.stringify(body.content ?? '')
      if (text.includes('#ok')) { json(envelope({ messageId: `preview-sent-${++sentCount}` })); return }
      if (text.includes('#timeout')) { json({ success: false, code: 'instance_timeout', error: 'The instance did not answer in time' }, 504); return }
      json({ success: false, code: 'preview_read_only', error: '本地预览不发送消息。请使用真实 Host 验证。' }, 403); return
    }
    if (/endpoint\.(?:requests|inboxRequests|inboxNotices|inboxMessages)/u.test(type)) { json(envelope({ requests: [], notices: [], messages: [], total: 0, hasMore: false })); return }
    if (type === 'inbox.messages') {
      const channel = { id: String(body.channelId ?? '10001'), type: body.channelType ?? 'private', name: body.channelType === 'group' ? '产品试验群' : '演示用户' }
      const rows = endpoint.name === 'preview-community' ? chatHistory[`${channel.type}:${channel.id}`] ?? [] : []
      const now = CHAT_NOW
      json(envelope({ inboxEnabled: true, messages: rows.map((row, index) => ({
        id: index + 1, platformMessageId: `preview-${channel.type}-${channel.id}-${index + 1}`, endpoint: endpoint.endpoint, channel,
        conversation: { endpoint: endpoint.endpoint, kind: channel.type, id: channel.id },
        sender: row.sender, timestamp: now - row.at, direction: row.direction, content: [{ type: 'text', data: { text: row.text } }],
      })) })); return
    }
    if (type === 'inbox.requests') { json(envelope({ inboxEnabled: true, requests: [] })); return }
    if (type === 'inbox.notices') { json(envelope({ inboxEnabled: true, notices: [] })); return }
    if (type === 'db:select' && body.table === 'unified_inbox_message' && body.where?.endpoint_id === 'preview-community') {
      // Last message per conversation for the list previews and unread counts.
      const now = CHAT_NOW
      const rows = Object.entries(chatHistory).flatMap(([key, items]) => {
        const [kind, id] = key.split(':')
        return items.map(item => ({ channel_id: id, channel_type: kind, channel_name: kind === 'group' ? '产品试验群' : null, sender_name: kind === 'private' ? '演示用户' : item.sender.name,
          content: JSON.stringify([{ type: 'text', data: { text: item.text } }]), created_at: now - item.at }))
      })
      json(envelope({ rows, total: rows.length, columns: [] })); return
    }
    if (type === 'db:select') { json(envelope({ rows: [], total: 0, columns: [] })); return }
    if (type === 'endpoint.history') { json(envelope({ messages: [], total: 0, hasMore: false })); return }
    if (type === 'config:get') { json(envelope({ configVersion: 2, plugin: { name: 'ui-preview' }, plugins: {} })); return }
    if (type === 'config:allSchemas' || type === 'config:schemas') { json(envelope({ schemas: {} })); return }
    json({ success: false, code: 'preview_read_only', error: '本地预览不执行此操作。请使用真实 Host 验证业务效果。' }, 503); return
  }
  json({ success: false, error: 'This endpoint is not provided by the local UI fixture.' }, 404)
})
server.listen(port, '127.0.0.1', () => console.log(`Read-only UI fixture at http://127.0.0.1:${port}; synthetic token: ui-preview`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)) })
