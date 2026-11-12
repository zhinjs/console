import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { filterTaskOverview, taskOverviewRows } from '../console-ui/src/pages/task-overview-model.mjs'
import { profileUsages } from '../console-ui/src/pages/inference/model.mjs'

const target = { endpoint: { id: 'bot-1', adapter: 'qq' }, kind: 'group', id: 'room/1' }
const sources = {
  admin: { providers: [{ owner: 'root/reminder', title: '提醒', tasks: [
    { id: 't1', title: '早报', target, state: 'scheduled', nextRunAt: 3000, parameters: {}, actions: [] },
    { id: 't2', title: '周报', target, state: 'failed', lastRunAt: 1000, parameters: {}, actions: [] },
  ] }] },
  schedules: {
    memory: [{ type: 'memory', id: 'm1', description: '心跳', expression: '0 * * * * *', running: true, nextExecution: 2000, plugin: 'heartbeat' }],
    persistent: [{ type: 'persistent', id: 'job-1', cronExpression: '0 0 9 * * *', prompt: '总结群聊', enabled: false, lastStatus: 'ok', lastExecutedAt: 500 }],
  },
  assistant: { jobs: [{ id: 'job-1', enabled: false, state: {} }, { id: 'job-2', label: '巡检', enabled: true, state: { lastStatus: 'error', nextRunAtMs: 4000 } }] },
  approvals: { pending: [{ id: 'a1', toolName: 'shell', sessionKey: 'qq:bot-1:group:1', expiresAt: 9000 }] },
}

test('one list covers every source with type, status, next run, last result, target and approval', () => {
  const { rows, unavailable } = taskOverviewRows(sources, 'zh-CN')
  assert.deepEqual(unavailable, [])
  assert.deepEqual(rows.map(row => row.key), [
    'approval:a1', 'assistant:job-2', 'admin:root/reminder:t2', 'memory:m1:heartbeat', 'admin:root/reminder:t1', 'persistent:job-1',
  ], 'approvals first, then failures, then by next run')
  const admin = rows.find(row => row.key === 'admin:root/reminder:t1')
  assert.equal(admin.target, 'qq / bot-1 / group:room/1')
  assert.equal(admin.targetHref, '/scope/qq/bot-1/group%3Aroom%2F1')
  assert.equal(admin.nextRunAt, 3000)
  assert.equal(rows.find(row => row.key === 'admin:root/reminder:t2').lastResult.tone, 'destructive')
  assert.equal(rows.find(row => row.key === 'persistent:job-1').status.code, 'paused')
  assert.equal(rows.filter(row => row.key.endsWith('job-1')).length, 1, 'a stored reminder is also an assistant job; it is listed once')
  assert.equal(rows[0].approval.startsWith('等待审批'), true)
  assert.deepEqual(filterTaskOverview(rows, 'schedule').map(row => row.type), ['schedule', 'schedule'])
  assert.equal(filterTaskOverview(rows, 'all').length, rows.length)
})

test('a source that could not be read is reported, not shown as having no tasks', () => {
  const { rows, unavailable } = taskOverviewRows({ admin: null, schedules: null, assistant: { jobs: [] } }, 'en')
  assert.deepEqual(rows, [])
  assert.deepEqual(unavailable, ['admin', 'schedule'])
  assert.deepEqual(taskOverviewRows({ ...sources, approvals: null }).unavailable, ['approvals'])
  for (const row of taskOverviewRows(sources, 'en').rows) assert.doesNotMatch(`${row.typeLabel} ${row.status.label}`, /[\u3400-\u9fff]/, row.key)
})

test('the task form picks the target conversation from the account and keeps manual entry as an advanced option', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
  assert.match(source, /<TaskConversationChoice endpoint=\{selectedEndpoint\.endpoint\}/)
  assert.match(source, /手动填写会话（高级）/)
  const picker = readFileSync(new URL('../console-ui/src/pages/TaskConversationChoice.tsx', import.meta.url), 'utf8')
  assert.match(picker, /useConversationList\(\{ adapter: endpoint\.adapter, endpoint: endpoint\.id, query \}\)/)
  assert.match(picker, /setTimeout\(\(\) => setQuery\(draft\.trim\(\)\), 300\)/)
})

test('a model lists the purposes that reference it; unknown purposes are not reported as unused', () => {
  const purposes = {
    defaults: { chat: 'p1', summary: 'p2', perception: { profile: 'p2', fallbacks: ['p1'] } },
    decisions: { skills: { mode: 'active', profile: 'p1' }, custom: { mode: 'shadow', profile: 'p1' } },
    agents: { helper: 'p1' },
    adapters: { qq: { chat: 'p1' } },
    endpoints: { 'qq/bot-1': { perception: { profile: 'p1' } } },
    scenes: { 'qq:bot-1:group:1': { chat: 'p1' } },
  }
  assert.deepEqual(profileUsages(purposes, 'p1', 'zh-CN').map(row => row.label), [
    '默认聊天', '默认识图（备选）', '决策：技能选择', '决策：custom', 'Agent helper', '适配器 qq 的聊天', '账号 qq/bot-1 的识图', '会话 qq:bot-1:group:1 的聊天',
  ])
  assert.deepEqual(profileUsages(purposes, 'p2', 'en').map(row => row.label), ['Default summary', 'Default image understanding'])
  assert.deepEqual(profileUsages(purposes, 'p3'), [])
  assert.equal(profileUsages(undefined, 'p1'), null)
})
