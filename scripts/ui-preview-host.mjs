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
// Object tree fixtures (feature.* ADR 0050 / 0055, chat-roles.* ADR 0056).
const LEVELS = ['global', 'adapter', 'endpoint', 'conversation']
const features = [
  { plugin: 'welcome', displayName: '群欢迎', levels: LEVELS, hasSchema: true, globalEnabled: true, conversationFields: ['text'] },
  { plugin: 'repeater', displayName: '复读机', levels: LEVELS, hasSchema: false, globalEnabled: true, conversationFields: [] },
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
// Layered values for the 功能 tab: welcome.text overridden on the icqq adapter and in group 20001,
// repeater switched off on the preview-community account (so its conversations are locked), rss off globally.
function featureDetail(body) {
  const feature = features.find(item => item.plugin === body.plugin) ?? features[0]
  const level = body.level
  const key = body.key ?? ''
  const base = { revision: 'preview-1', plugin: feature.plugin, level, key, levels: feature.levels, conversationFields: feature.conversationFields ?? [] }
  if (feature.plugin === 'welcome') {
    const properties = { text: { type: 'string', title: '欢迎语', default: '欢迎新朋友' }, mention: { type: 'boolean', title: '@新成员', default: true } }
    const schema = { type: 'object', properties: level === 'conversation' ? { text: properties.text } : properties }
    const onIcqq = key === 'icqq' || key.startsWith('icqq/')
    const inGroup = key === 'icqq/preview-community/group:20001'
    const text = inGroup ? '欢迎来到产品试验群' : onIcqq ? '欢迎来到 icqq 社区' : '欢迎新朋友'
    const values = level === 'global' ? { text: '欢迎新朋友', mention: true } : level === 'adapter' && onIcqq ? { text } : inGroup ? { text } : {}
    return { ...base, schema, values, effective: { text, mention: true }, sources: { '/text': inGroup ? 'conversation' : onIcqq ? 'adapter' : 'global', '/mention': 'global' }, enabled: true }
  }
  if (feature.plugin === 'repeater') {
    const account = key === 'icqq/preview-community'
    const below = key.startsWith('icqq/preview-community/')
    return { ...base, schema: null, values: account ? { enabled: false } : {}, effective: {}, sources: account ? { '/enabled': 'endpoint' } : {},
      enabled: !(account || below), ...(below ? { lockedBy: 'endpoint' } : {}) }
  }
  const schema = { type: 'object', properties: { interval: { type: 'integer', title: '检查间隔（分钟）', default: 30 } } }
  return { ...base, schema, values: level === 'global' ? { interval: 30 } : {}, effective: { interval: 30 }, sources: { '/interval': 'global' }, enabled: false,
    ...(level === 'global' ? {} : { lockedBy: 'global' }) }
}
const loginTasks = [
  { id: 'preview-login-1', adapter: 'telegram', endpointKey: 'preview-support', type: 'sms', payload: { message: '平台要求输入短信验证码完成登录。', phone: '+86 138****0000' }, createdAt: Date.now() - 60_000, expiresAt: Date.now() + 240_000 },
]
const adapterStatus = { adapterKey: 'icqq', displayName: 'ICQQ', page: '/icqq', canAdd: true, canRemove: true, configStore: true,
  fields: [{ key: 'uin', type: 'string', required: true, env: false, secret: false, label: 'QQ 号' }, { key: 'password', type: 'string', required: false, env: true, secret: true, label: '密码' }],
  running: [{ id: 'preview-community', mode: 'qrcode' }], configured: [{ id: 'preview-community', values: { uin: '10000' } }, { id: 'preview-archive', values: { uin: '10009' } }], actions: [] }

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
  if (url.pathname === '/console/api/pages') { json({ pages: [{ route: '/icqq', localName: 'index', owner: 'adapter-icqq', source: 'plugins/adapters/icqq/pages/index/index.tsx' }] }); return }
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
    if (type === 'login.list') { json(envelope({ tasks: loginTasks })); return }
    if (type === 'plugin.adapter-icqq.status') { json(envelope(adapterStatus)); return }
    if (type === 'feature.list') { json(envelope({ revision: 'preview-1', features })); return }
    if (type === 'feature.get') { json(envelope(featureDetail(body))); return }
    if (type === 'feature.matrix') {
      json(envelope({ revision: 'preview-1', adapters: ['icqq', 'telegram'], endpoints: { icqq: ['preview-community', 'preview-archive'], telegram: ['preview-support'] },
        conversationOverrides: { icqq: { 'preview-community': 2 } },
        rows: features.map(item => ({ plugin: item.plugin, displayName: item.displayName, global: { enabled: item.globalEnabled, overridden: false },
          adapters: { icqq: { enabled: item.globalEnabled, overridden: item.plugin === 'welcome', ...(item.globalEnabled ? {} : { lockedBy: 'global' }) }, telegram: { enabled: item.globalEnabled, overridden: false, ...(item.globalEnabled ? {} : { lockedBy: 'global' }) } },
          ...(item.plugin === 'rss' ? {} : { conversationOverrides: { icqq: { 'preview-community': 1 } } }) })) }))
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
    if (type === 'chat-roles.mappings') {
      // Draft protocol (ADR 0056 §4): icqq answers, other adapters behave like an older Host.
      if (!String(body.key ?? '').startsWith('icqq')) { json({ success: false, error: `Unknown RPC type: ${type}` }, 400); return }
      const rule = { match: { standing: ['owner', 'admin'] }, grant: 'admin' }
      json(envelope({ layers: [{ level: 'default', rules: [rule], inherit: true }, { level: 'adapter', rules: [{ match: { role: ['moderator'] }, grant: 'trusted' }], inherit: true }],
        effective: [{ ...rule, level: 'default' }, { match: { role: ['moderator'] }, grant: 'trusted', level: 'adapter' }] }))
      return
    }
    if (type === 'gateway.instance.status') { json(envelope({ instanceId: 'preview', state: 'running', lastExitCode: null, lastExitSignal: null, recentRestarts: 0 })); return }
    if (type === 'agent.engagements.list') { json(envelope({ engagements: [engagement.summary] })); return }
    if (type === 'agent.engagements.get') {
      if (body.engagementId === engagement.summary.engagementId) json(envelope(engagement))
      else json({ success: false, error: 'Engagement 不存在' }, 404)
      return
    }
    if (type === 'agent.venues.list') { json(envelope({ venues })); return }
    if (type === 'endpoint.info' || type === 'endpoint.get') {
      const known = endpoints.find(item => item.name === (body.endpointKey ?? body.endpointId ?? body.data?.endpointKey))
      if (known) json(envelope(known)); else json({ success: false, error: '账号不存在' }, 404)
      return
    }
    if (type === 'endpoint.test') { json(envelope({ reachable: true, connected: true, latencyMs: 24, message: '本地预览连接正常' })); return }
    if (type === 'endpoint.friends') { json(envelope({ friends: [{ user_id: 10001, nickname: '演示用户', remark: '界面测试' }] })); return }
    if (type === 'endpoint.groups') { json(envelope({ groups: [{ group_id: 20001, name: '产品试验群' }] })); return }
    if (type === 'endpoint.channels') { json(envelope({ channels: [] })); return }
    if (type === 'endpoint.group_members' || type === 'endpoint.groupMembers') { json(envelope({ members: [] })); return }
    if (/endpoint\.(?:requests|inboxRequests|inboxNotices|inboxMessages)/u.test(type)) { json(envelope({ requests: [], notices: [], messages: [], total: 0, hasMore: false })); return }
    if (type === 'inbox.messages') {
      const channel = { id: String(body.channelId ?? '10001'), type: body.channelType ?? 'private', name: body.channelType === 'group' ? '产品试验群' : '演示用户' }
      json(envelope({ inboxEnabled: true, messages: [
        { id: 1, platformMessageId: 'preview-inbound-1', endpoint: endpoint.endpoint, channel, sender: { id: '10001', name: '演示同事' }, timestamp: Date.now() - 120_000, direction: 'inbound', content: [{ type: 'text', data: { text: '今天的发布准备完成了吗？我想确认一下机器人账号和任务的运行情况。' } }] },
        { id: 2, platformMessageId: 'preview-outbound-2', endpoint: endpoint.endpoint, channel, sender: { id: 'self', name: 'Zhin' }, timestamp: Date.now() - 60_000, direction: 'outbound', content: [{ type: 'text', data: { text: '账号已连接，运行记录也已检查。\n\n这是一段本地界面预览消息，不会发送到真实平台。' } }] },
      ] })); return
    }
    if (type === 'inbox.requests') { json(envelope({ inboxEnabled: true, requests: [] })); return }
    if (type === 'inbox.notices') { json(envelope({ inboxEnabled: true, notices: [] })); return }
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
