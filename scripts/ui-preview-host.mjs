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
  { id: 4, timestamp: Date.now() - 10_000, level: 'info', name: 'icqq', plugin: 'icqq', message: 'preview-community 向 group 20001 发送消息成功' },
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
// Message events in the bounded Console journal (首页消息量与最近消息).
const now = Date.now()
const conversation = (kind, id) => ({ endpoint: { adapter: 'icqq', id: 'preview-community' }, kind, id })
const messageEvent = (eventId, minutesAgo, direction, kind, id, text, sender) => ({ runtimeId: 'ui-preview', eventId, type: 'message.receive', timestamp: now - minutesAgo * 60_000,
  data: { direction, timestamp: now - minutesAgo * 60_000, endpointKey: 'preview-community', adapter: 'icqq', conversation: conversation(kind, id), channelType: kind, channelId: id,
    content: [{ type: 'text', data: { text } }], ...(sender ? { sender } : {}) } })
const messageEvents = [
  messageEvent(1, 300, 'inbound', 'group', '20001', '早上好，今天的例会几点？', { id: '10001', name: '演示同事' }),
  messageEvent(2, 299, 'outbound', 'group', '20001', '例会在上午 10 点，会议室 3。'),
  messageEvent(3, 180, 'inbound', 'private', '10001', '帮我查一下昨天的发布记录', { id: '10001', name: '演示用户' }),
  messageEvent(4, 179, 'outbound', 'private', '10001', '昨天共发布 2 次，均已完成。'),
  messageEvent(5, 42, 'inbound', 'group', '20001', '有人知道新版本什么时候上线吗？', { id: '10005', name: '产品同学' }),
  messageEvent(6, 12, 'inbound', 'group', '20001', '今天的发布准备完成了吗？', { id: '10001', name: '演示同事' }),
  messageEvent(7, 11, 'outbound', 'group', '20001', '准备完成，等待最后确认。'),
]
// plugin.root.* fixtures (决策回放、Token 用量、群聊插话、技能助手、工具审批).
const decisionRow = (minutesAgo, extra) => ({ id: `d-${minutesAgo}`, ts: now - minutesAgo * 60_000, turn_id: `turn-${minutesAgo}`, instance_id: 'preview-community', platform: 'icqq',
  scene_id: 'group:20001', user_id: '10001', kind: 'speak_gate', outcome: 'allow', reason_code: 'addressed', reason_detail: null, payload: {}, actor: 'policy', actor_id: null, ...extra })
const decisions = [decisionRow(11, {}), decisionRow(42, { outcome: 'deny', reason_code: 'cannot_speak_muted' }), decisionRow(180, { scene_id: 'private:10001' })]
const HOUR = 3_600_000
const usageStats = (session) => {
  const sessions = [
    { sessionKey: 'icqq:preview-community:group:20001', turns: 6, calls: 9, inputTokens: 18_400, outputTokens: 2_100, cacheReadTokens: 9_800 },
    { sessionKey: 'icqq:preview-community:private:10001', turns: 2, calls: 3, inputTokens: 4_200, outputTokens: 600, cacheReadTokens: 1_100 },
  ].filter(row => !session || (session.endsWith('*') ? row.sessionKey.startsWith(session.slice(0, -1)) : row.sessionKey.includes(session)))
  const sum = key => sessions.reduce((total, row) => total + row[key], 0)
  const start = Math.floor((now - 7 * 24 * HOUR) / (24 * HOUR)) * 24 * HOUR
  return { range: { since: now - 7 * 24 * HOUR, until: now, bucket: 'day', timeZone: 'Asia/Shanghai' },
    totals: { turns: sum('turns'), calls: sum('calls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheShare: sum('inputTokens') ? sum('cacheReadTokens') / sum('inputTokens') : 0 },
    byModel: sum('calls') ? [{ provider: 'preview', model: 'chat-small', calls: sum('calls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens') }] : [],
    bySession: sessions,
    series: Array.from({ length: 7 }, (_, index) => ({ bucketStart: start + index * 24 * HOUR, calls: index > 3 ? 4 : 0, inputTokens: index > 3 ? Math.round(sum('inputTokens') / 3) : 0, outputTokens: index > 3 ? 900 : 0, cacheReadTokens: index > 3 ? Math.round(sum('cacheReadTokens') / 3) : 0, byModel: index > 3 ? { 'preview/chat-small': Math.round(sum('inputTokens') / 3) } : {} })),
    segments: { history: 12_000, fixed: 6_000, user: 4_600 }, filesRead: 1, malformedLines: 0 }
}
const ambientStatus = { enabled: true, mode: 'shadow', groups: 1, judges: ['preview/chat-small'], last24h: { spoke: 0, watched: 3, stayed_quiet: 5, skipped: 1 }, decisionShadow: { agreed: 3, disagreed: 0 },
  recent: [{ at: now - 42 * 60_000, group: 'icqq:20001', outcome: 'watched', confidence: 0.7, judge: 'decision' }, { at: now - 90 * 60_000, group: 'icqq:20001', outcome: 'stayed_quiet' }], updatedAt: now - 42 * 60_000 }
const configSource = 'ai:\n  trigger:\n    ambient:\n      mode: shadow\n      conversations:\n        - icqq:30002\n      maxPerHour: 4\n'
const target = { endpoint: { adapter: 'icqq', id: 'preview-community' }, kind: 'group', id: '20001' }
const taskProviders = { generation: 1, providers: [{ owner: 'root/reminder', packageName: '@zhin.js/plugin-reminder', title: '群提醒', description: '按时间在会话里发一条提醒。', schema: { type: 'object', properties: { text: { type: 'string', title: '提醒内容' }, at: { type: 'string', title: '时间' } }, required: ['text'] },
  effects: ['到点后在目标会话发送一条消息'], revision: 'r1', receipts: [], tasks: [
    { id: 'task-1', ownership: 'administrator', title: '周会提醒', target, state: 'scheduled', createdAt: now - 86_400_000, nextRunAt: now + 5 * HOUR, timezone: 'Asia/Shanghai', parameters: { text: '10 点周会' }, actions: ['pause', 'cancel', 'update'] },
    { id: 'task-2', ownership: 'administrator', title: '发布检查', target: { ...target, kind: 'private', id: '10001' }, state: 'failed', createdAt: now - 2 * 86_400_000, lastRunAt: now - 3 * HOUR, detail: '目标会话不可达', parameters: { text: '检查发布' }, actions: ['cancel'] },
  ] }] }
const scheduleList = { memory: [{ type: 'memory', id: 'heartbeat', description: '心跳检测', expression: '0 */5 * * * *', running: true, nextExecution: now + 4 * 60_000, plugin: 'heartbeat' }],
  persistent: [{ type: 'persistent', id: 'job-daily', cronExpression: '0 0 9 * * *', prompt: '总结昨天的群聊要点', label: '每日群聊摘要', enabled: true, nextExecution: now + 14 * HOUR, lastStatus: 'ok', lastExecutedAt: now - 10 * HOUR }],
  capabilities: { persistent: true } }
const assistantJobs = { eventsActive: true, jobs: [{ id: 'job-daily', label: '每日群聊摘要', enabled: true, state: { lastStatus: 'ok', nextRunAtMs: now + 14 * HOUR } }, { id: 'job-watch', label: '错误巡检', enabled: true, state: { lastStatus: 'error', lastError: 'timeout', nextRunAtMs: now + HOUR } }] }
const toolApprovals = { available: true, pending: [{ id: 'approval-1', toolName: 'shell.exec', sessionKey: 'icqq:preview-community:group:20001', requesterId: '10001', createdAt: now - 5 * 60_000, expiresAt: now + 25 * 60_000, status: 'pending', args: { command: 'ls' } }] }
const pluginRoot = {
  decisions: body => ({ persistent: true, items: decisions.filter(row => (!body.platform || row.platform === body.platform) && (!body.sceneId || row.scene_id === body.sceneId)), nextBefore: null }),
  'usage-stats': body => usageStats(body.session),
  ambient: () => ambientStatus,
  skills: () => ({ enabled: true, tasks: [], recent: [], updatedAt: null }),
  'tool-approvals': () => toolApprovals,
  control: () => ({ available: true, revision: 1, persistent: true, instance: { emergency_stop: false, muted: false, read_only: false, mention_only: true } }),
}
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
// Plugin pages (插件管理 / 详情 / 市场, ADR 0054 §4): instance plugins, gateway packages and transactions.
const management = (instanceKey, packageName, version, extra = {}) => ({ packageName, instanceKey, installed: true, plugin: true, declared: true, version, revision: 'preview-r1',
  projectRevision: 'preview-p1', status: 'enabled', dependencies: 'passed', validation: { valid: true, errors: [], missingEnv: [] }, generation: 4, published: true,
  readiness: 'ready', restartRequired: false, disabled: false, issues: [], verification: 'not-configured', ...extra })
const instancePlugins = [
  { name: 'welcome', description: '新成员入群时发送欢迎语', status: 'active', instanceKey: 'welcome', packageName: '@zhin.js/plugin-welcome', version: '1.4.0', manageable: true, packageRoot: './node_modules/@zhin.js/plugin-welcome',
    features: [{ name: 'command', icon: 'Terminal', desc: '命令', count: 2, items: [{ name: 'welcome', desc: '查看或修改欢迎语' }, { name: 'welcome-test' }] }, { name: 'middleware', icon: 'Layers', desc: '中间件', count: 1, items: [{ name: 'welcome-join' }] }],
    management: management('welcome', '@zhin.js/plugin-welcome', '1.4.0') },
  { name: 'repeater', description: '复读群里连续出现的消息', status: 'active', instanceKey: 'repeater', packageName: '@zhin.js/plugin-repeater', version: '1.1.4', manageable: true, packageRoot: './node_modules/@zhin.js/plugin-repeater',
    features: [{ name: 'middleware', icon: 'Layers', desc: '中间件', count: 1, items: [{ name: 'repeater' }] }], management: management('repeater', '@zhin.js/plugin-repeater', '1.1.4') },
  { name: 'rss', description: '订阅 RSS 并推送到会话', status: 'inactive', instanceKey: 'rss', packageName: '@zhin.js/plugin-rss', version: '0.9.2', manageable: true, packageRoot: './node_modules/@zhin.js/plugin-rss',
    features: [], management: management('rss', '@zhin.js/plugin-rss', '0.9.2', { status: 'missing-config', published: false, generation: null, readiness: 'unknown', validation: { valid: false, errors: [{ path: '$.feeds', message: '至少需要一个订阅源' }], missingEnv: ['RSS_PROXY'] } }) },
]
const gatewayPackages = { packageManager: 'pnpm@9.0.2', packages: [
  { name: '@zhin.js/plugin-welcome', range: '^1.4.0', dependencyType: 'dependencies', installedVersion: '1.4.0', catalog: 'market' },
  { name: '@zhin.js/plugin-repeater', range: '^1.1.0', dependencyType: 'dependencies', installedVersion: '1.1.4', catalog: 'market' },
  { name: '@zhin.js/plugin-rss', range: '^0.9.0', dependencyType: 'dependencies', installedVersion: '0.9.2', catalog: 'market' },
  { name: '@zhin.js/adapter-qq', range: '^2.0.0', dependencyType: 'dependencies', installedVersion: '2.0.1', catalog: 'adapter' },
  { name: 'zhin.js', range: '^1.1.0', dependencyType: 'dependencies', installedVersion: '1.1.9' },
] }
const marketUpdates = [{ name: '@zhin.js/plugin-repeater', current: '1.1.4', latest: '1.2.0' }]
const marketPlugins = [
  ['@zhin.js/plugin-welcome', '群欢迎', '新成员入群时发送欢迎语，可按会话覆盖。', 'feature', 3200],
  ['@zhin.js/plugin-repeater', '复读机', '复读群里连续出现的消息。', 'game', 2100],
  ['@zhin.js/plugin-rss', 'RSS 订阅', '订阅 RSS 并推送到会话。', 'service', 1800],
  ['@zhin.js/adapter-qq', 'QQ 官方机器人', '接入 QQ 官方机器人平台。', 'adapter', 5400],
  ['@zhin.js/plugin-calendar', '日程提醒', '在会话里创建日程并按时提醒。', 'util', 960],
  ['zhin-plugin-weather', '天气', '查询城市天气，第三方插件。', 'util', 420],
].map(([name, displayName, description, category, monthly]) => ({ name, displayName, version: '1.2.0', description, author: name.startsWith('@zhin.js') ? 'zhinjs' : 'community', isOfficial: name.startsWith('@zhin.js'),
  official: name.startsWith('@zhin.js'), category, keywords: ['zhin', category], npm: `https://www.npmjs.com/package/${name}`, date: '2026-10-28T00:00:00Z', downloads: { weekly: Math.round(monthly / 4), monthly } }))
const pluginPermissions = [
  { permission: 'welcome:read', plugin: 'welcome', level: 'read', description: '查看欢迎语统计' },
  { permission: 'welcome:test', plugin: 'welcome', level: 'operate', description: '发送测试欢迎语' },
  { permission: 'welcome:config.write', plugin: 'welcome', level: 'manage', description: '修改欢迎模板' },
]
const previewCommands = [
  { id: 'root/welcome\u0000zhin.command\u0000welcome', owner: 'root/welcome', name: 'welcome', description: '查看或修改欢迎语', permits: ['group(admin)'] },
  { id: 'root/rss\u0000zhin.command\u0000rss add', owner: 'root/rss', name: 'rss add', description: '添加订阅', permits: [] },
]
function transactionResult(operation, packages) {
  const authorized = packages.map(spec => { const at = spec.lastIndexOf('@'); const name = at > 0 ? spec.slice(0, at) : spec; return { name, ...(at > 0 ? { version: spec.slice(at + 1) } : {}), spec, source: 'market' } })
  const base = { id: `preview-${Date.now()}`, operation, packages: authorized, instance: { before: 'running', after: 'running' }, startedAt: Date.now() - 4200, finishedAt: Date.now(), logTail: [] }
  // The adapter needs its first configuration (needsConfiguration); the calendar update shows a rollback.
  if (operation === 'install' && authorized.some(item => item.name === '@zhin.js/adapter-qq')) {
    return { ...base, ok: true, status: 'succeeded', needsConfiguration: [{ name: '@zhin.js/adapter-qq', instanceKey: 'qq', missing: ['endpoints'], missingEnv: ['QQ_SECRET'] }] }
  }
  if (operation === 'uninstall' && authorized.some(item => item.name === '@zhin.js/plugin-rss')) {
    return { ...base, ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: '实例在 30 秒内没有就绪', logTail: ['[rss] feeds is required', 'instance exited with code 1'] }
  }
  return { ...base, ok: true, status: 'succeeded' }
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
  if (url.pathname === '/api/events/history') { json(envelope({ items: messageEvents, hasMore: false, nextAfter: messageEvents.length, runtimeId: 'ui-preview', latestEventId: messageEvents.length, oldestAvailableEventId: 1, gap: false })); return }
  if (url.pathname === '/api/tasks/providers') { json(envelope(taskProviders)); return }
  if (url.pathname === '/api/tasks/use-cases') { json(envelope({ useCases: [] })); return }
  if (url.pathname === '/api/assistant/jobs') { json(envelope(assistantJobs)); return }
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
  if (url.pathname === '/api/logs/stats') { json(envelope({ total: 3, byLevel: { trace: 0, debug: 0, info: 2, warn: 1, error: 0, fatal: 0 }, levels: { info: 2, warn: 1, error: 0 }, oldestTimestamp: new Date(logs[2].timestamp).toISOString(), oldest: logs[2].timestamp, newest: logs[0].timestamp })); return }
  if (url.pathname === '/api/logs') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const rows = logs.filter(log => !q || `${log.message} ${log.name}`.toLowerCase().includes(q))
      .map(log => ({ id: log.id, level: log.level, message: log.message, source: log.name, timestamp: new Date(log.timestamp).toISOString() }))
    json({ success: true, data: rows, total: rows.length, page: 1, pageSize: 100, totalPages: 1, sources: [{ source: 'preview', count: rows.length }] }); return
  }
  if (url.pathname === '/api/plugins') {
    if (process.env.UI_PREVIEW_INSTANCE_DOWN) { json({ success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', state: 'crashed', error: 'The Zhin instance is not running' }, 503); return }
    json(envelope(instancePlugins.map(({ features: list, ...item }) => ({ ...item, features: list.map(({ items, ...rest }) => rest), config: { hasSchema: true } }))))
    return
  }
  if (url.pathname.startsWith('/api/plugins/')) {
    if (process.env.UI_PREVIEW_INSTANCE_DOWN) { json({ success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', state: 'crashed', error: 'The Zhin instance is not running' }, 503); return }
    const key = decodeURIComponent(url.pathname.slice('/api/plugins/'.length))
    const found = instancePlugins.find(item => item.instanceKey === key || item.packageName === key)
    if (found) json(envelope(found)); else json({ success: false, error: 'Plugin not found' }, 404)
    return
  }
  if (url.pathname === '/api/marketplace/updates') { json(envelope(marketUpdates)); return }
  if (url.pathname === '/pub/marketplace/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase(), category = url.searchParams.get('category')
    const items = marketPlugins.filter(item => (!q || `${item.name} ${item.description}`.toLowerCase().includes(q)) && (!category || item.category === category))
    json({ success: true, data: items, total: items.length }); return
  }
  if (url.pathname.startsWith('/pub/marketplace/detail/')) {
    const name = decodeURIComponent(url.pathname.slice('/pub/marketplace/detail/'.length))
    const item = marketPlugins.find(entry => entry.name === name)
    if (!item) { json({ success: false, error: 'Not in the preview index' }, 404); return }
    json(envelope({ name, version: item.version, description: item.description, license: 'MIT', author: item.author, homepage: '', repository: 'git+https://github.com/zhinjs/zhin.git', keywords: item.keywords,
      engines: { node: '>=22.19.0' }, peerDependencies: { 'zhin.js': '^1.1.0' }, downloads: item.downloads, readme: `# ${item.displayName}\n\n${item.description}\n\n本地预览数据。`, versions: ['1.0.0', '1.1.0', '1.2.0'], lastPublish: item.date }))
    return
  }
  if (url.pathname === '/api/commands/permissions') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const commands = previewCommands.filter(item => !q || `${item.name} ${item.owner}`.toLowerCase().includes(q))
    json(envelope({ generation: 4, page: 1, pageSize: 50, total: commands.length, commands })); return
  }
  if (url.pathname === '/api/commands/permissions/explain' && request.method === 'POST') {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw || '{}')
    const command = previewCommands.find(item => item.id === body.commandId) ?? previewCommands[0]
    json(envelope({ generation: 4, simulation: true, command, permissionHost: 'present', adapter: { outcome: 'not_evaluated', reason: '本地预览不评估适配器约束' },
      rules: command.permits.map((rule, index) => ({ index, rule, kind: 'role', outcome: 'unknown', reason: '没有提供假设角色' })),
      summary: { outcome: command.permits.length ? 'unknown' : 'match', reason: command.permits.length ? '缺少角色依据' : '没有声明 permit 限制' }, unconstrained: [], assumptions: ['本地预览数据'] }))
    return
  }
  if (url.pathname.startsWith('/api/introspection/')) {
    const kind = url.pathname.split('/').pop()
    const rows = kind === 'commands' ? [
      { pattern: 'welcome [text]', desc: '查看或修改欢迎语', plugin: 'welcome', permissions: ['group(admin)'] },
      { pattern: 'welcome-test', desc: '发送一条测试欢迎语', plugin: 'welcome' },
      { pattern: 'rss add <url>', desc: '添加订阅', plugin: 'rss' },
    ] : kind === 'middlewares' ? [{ name: 'repeater', phase: 'receive', order: 10, owner: 'root/repeater' }, { name: 'welcome-join', phase: 'notice', order: 20, owner: 'root/welcome' }] : []
    json(envelope({ items: rows, total: rows.length, page: 1, pageSize: 25, totalPages: 1 })); return
  }
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
    if (type.startsWith('plugin.root.') && Object.hasOwn(pluginRoot, type.slice('plugin.root.'.length))) { json(envelope(pluginRoot[type.slice('plugin.root.'.length)](body.data ?? {}))); return }
    if (type === 'schedule:list') { json(envelope(scheduleList)); return }
    if (type === 'config:get-source') { json(envelope({ source: configSource, revision: 'preview-1' })); return }
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
    if (type === 'gateway.packages.list') { json(envelope(gatewayPackages)); return }
    if (type === 'gateway.packages.plan') {
      const specs = Array.isArray(body.data?.packages) ? body.data.packages : []
      json(envelope({ operation: body.data?.operation ?? 'install', packages: transactionResult('install', specs).packages, all: false, packageManager: gatewayPackages.packageManager, instanceState: 'running', restartsInstance: true }))
      return
    }
    if (type === 'gateway.packages.install' || type === 'gateway.packages.update' || type === 'gateway.packages.uninstall') {
      await new Promise(resolve => setTimeout(resolve, 600))
      json(envelope(transactionResult(type.split('.').pop(), Array.isArray(body.data?.packages) ? body.data.packages : []))); return
    }
    if (type === 'gateway.plugins.declare') {
      json({ success: false, code: 'invalid_input', error: '配置未通过插件 Schema 校验，未声明：$.endpoints required；缺少环境变量 QQ_SECRET', errors: [{ path: '$.endpoints', message: 'required' }], missingEnv: ['QQ_SECRET'] }, 400)
      return
    }
    if (type === 'iam.roles.list') { json(envelope({ roles: [], pluginPermissions })); return }
    if (type === 'schema:get') { json(envelope({ type: 'object', properties: { endpoints: { type: 'array', title: '机器人账号', items: { type: 'object', properties: { id: { type: 'string', title: 'AppID' } } } } }, required: ['endpoints'] })); return }
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
