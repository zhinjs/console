import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { scheduleIdOfKey, sessionKind, sessionLabel, sessionShortKey, withScheduleName } from '../console-ui/src/utils/session-label.mjs'
import { usageSessionLabel, usageSessionShortKey } from '../console-ui/src/pages/token-usage-model.mjs'
import { recentAgentSessions } from '../console-ui/src/pages/agent-workbench-model.mjs'

const PERSONAL = `personal-session:v1:${'ab12cd34'.repeat(8)}`
const SCENE = `scene-task:v1:${'9f8e7d6c'.repeat(8)}`
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('shared label: Token usage keeps the same function', () => {
  assert.equal(usageSessionLabel, sessionLabel)
  assert.equal(usageSessionShortKey, sessionShortKey)
})

test('shared label: hashed keys with only the key known get a kind and a short hash, never 「自定义会话」', () => {
  assert.equal(sessionLabel({ sessionKey: PERSONAL }), '私聊会话 #ab12cd34')
  assert.equal(sessionLabel({ sessionKey: SCENE }), '群聊 #9f8e7d6c')
  assert.equal(sessionLabel({ sessionKey: PERSONAL }, 'en'), `${translate('en', '私聊会话')} #ab12cd34`)
  assert.equal(sessionLabel({ sessionKey: SCENE }, 'en'), 'Group chat #9f8e7d6c')
  for (const key of [PERSONAL, SCENE, 'schedule:sched_1', 'weird']) assert.doesNotMatch(sessionLabel({ sessionKey: key }), /自定义会话/)
  // The key itself is never the visible name of a hashed session.
  for (const key of [PERSONAL, SCENE]) assert.ok(!sessionLabel({ sessionKey: key }).includes(key.slice(-20)))
})

test('shared label: platform, kind and scene name from the Host win over the key shape', () => {
  assert.equal(sessionLabel({ sessionKey: PERSONAL, platform: 'sandbox' }), 'sandbox · 私聊会话 #ab12cd34')
  assert.equal(sessionLabel({ sessionKey: SCENE, platform: 'icqq' }), 'icqq · 群聊 #9f8e7d6c')
  assert.equal(sessionLabel({ sessionKey: SCENE, platform: 'icqq', scopeKind: 'group' }), 'icqq · 群 #9f8e7d6c')
  assert.equal(sessionLabel({ sessionKey: SCENE, platform: 'icqq', scopeKind: 'group', sceneLabel: '产品试验群' }), 'icqq · 群 产品试验群')
  assert.equal(sessionLabel({ sessionKey: PERSONAL, platform: 'sandbox', scopeKind: 'private', sceneLabel: '小明' }, 'en'), `sandbox · ${translate('en', '私聊')} 小明`)
  assert.equal(sessionLabel({ sessionKey: PERSONAL, displayName: '小明的私聊' }), '小明的私聊')
  assert.equal(sessionLabel({ sessionKey: SCENE, displayName: 'icqq · 群 产品试验群' }, 'en'), `icqq · ${translate('en', '群')} 产品试验群`)
  assert.equal(sessionLabel({ sessionKey: 'icqq:bot:group:123' }), 'icqq · 群 123')
  assert.equal(sessionLabel({ sessionKey: 'http:api:session:1', scopeKind: 'http' }), 'HTTP')
})

test('shared label: scheduled tasks show their name, else their id', () => {
  assert.equal(sessionLabel({ sessionKey: 'schedule:sched_mwio9qd6_abc' }), '定时任务 sched_mwio9qd6_abc')
  assert.equal(sessionLabel({ sessionKey: 'schedule:sched_mwio9qd6_abc' }, 'en'), 'Scheduled task sched_mwio9qd6_abc')
  assert.equal(sessionLabel({ sessionKey: 'schedule:x', scopeKind: 'schedule' }), '定时任务 x', 'a kind without a name falls back to the id')
  assert.equal(sessionLabel(withScheduleName({ sessionKey: 'schedule:x' }, new Map([['x', '每日摘要']]))), '定时任务 每日摘要')
  assert.equal(scheduleIdOfKey('schedule:'), '')
  assert.equal(scheduleIdOfKey('schedule:a:b'), 'a:b')
})

test('shared label: short keys for tooltips', () => {
  assert.equal(sessionShortKey({ sessionKey: PERSONAL }), 'personal-session:ab12cd34')
  assert.equal(sessionShortKey({ sessionKey: SCENE }), 'scene-task:9f8e7d6c')
})

test('session kinds: the Host kind first, else the key shape, else unknown', () => {
  assert.equal(sessionKind({ sessionKey: SCENE }), 'group')
  assert.equal(sessionKind({ sessionKey: PERSONAL }), 'private')
  assert.equal(sessionKind({ sessionKey: PERSONAL, scopeKind: 'group' }), 'group')
  assert.equal(sessionKind({ sessionKey: SCENE, scopeKind: 'guild' }), 'channel')
  assert.equal(sessionKind({ sessionKey: 'x', scopeKind: 'direct' }), 'private')
  assert.equal(sessionKind({ sessionKey: 'icqq:bot:channel:1' }), 'channel')
  assert.equal(sessionKind({ sessionKey: 'icqq:bot:private:1' }), 'private')
  assert.equal(sessionKind({ sessionKey: 'schedule:1' }), 'schedule')
  assert.equal(sessionKind({ sessionKey: 'http:api:session:1' }), '')
  assert.equal(sessionKind({ sessionKey: `other:v1:${'a'.repeat(64)}` }), '')
  assert.equal(sessionKind(null), '')
})

test('workbench recent conversations keep the Host fields for the shared name, also for keys opened in this browser', () => {
  const recent = recentAgentSessions([PERSONAL], [
    { sessionKey: PERSONAL, turns: 2, lastAt: 9, platform: 'sandbox', scopeKind: 'private', sceneLabel: '小明' },
    { sessionKey: SCENE, turns: 1, lastAt: 5, platform: 'icqq' },
    { sessionKey: 'schedule:s1', turns: 1, lastAt: 1 },
  ])
  assert.deepEqual(recent.map(row => [row.key, row.source, row.turns]), [[PERSONAL, 'local', 2], [SCENE, 'trace', 1], ['schedule:s1', 'trace', 1]])
  assert.deepEqual(recent.map(row => sessionLabel({ sessionKey: row.key, displayName: row.label, platform: row.platform, scopeKind: row.scopeKind, sceneLabel: row.sceneLabel })),
    ['sandbox · 私聊 小明', 'icqq · 群聊 #9f8e7d6c', '定时任务 s1'])
})

test('pages use the shared label: no 「自定义会话」 fallback, full keys only in tooltips', () => {
  for (const file of ['components/AgentSessionPicker.tsx', 'pages/agent-workbench.tsx', 'pages/HostToolApprovalsPanel.tsx', 'pages/agent-sessions.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /自定义会话/, file)
    assert.match(source, /sessionLabel\(/, file)
  }
  const approvals = read('pages/HostToolApprovalsPanel.tsx')
  assert.doesNotMatch(approvals, />\{(?:review\.)?card\.sessionKey\}/, "the key is no visible text")
  assert.match(approvals, /title=\{card\.sessionKey\}/)
  assert.doesNotMatch(read('components/AgentSessionPicker.tsx'), /<code[^>]*>\{sessionKey\}<\/code>/)
  const page = read('pages/agent-sessions.tsx')
  assert.doesNotMatch(page, /个人会话没有聊天记录|个人会话不保存聊天记录/)
  assert.match(page, /sessionSummary\.others/)
})

test('key-only sessions: hashed keys of every kind and schedule:<id>; traces open by key', async () => {
  const { isHashedSessionKey, isKeyOnlySessionKey } = await import('../console-ui/src/utils/session-label.mjs')
  for (const key of [PERSONAL, SCENE, `other:v2:${'c'.repeat(16)}`]) assert.equal(isHashedSessionKey(key), true, key)
  for (const key of [`personal-session:v1:${'a'.repeat(32)}`, 'scene-task:v1:abc', 'icqq:bot:group:1', 'schedule:x']) assert.equal(isHashedSessionKey(key), false, key)
  assert.equal(isKeyOnlySessionKey('schedule:x'), true)
  assert.equal(isKeyOnlySessionKey('icqq:bot:group:1'), false)
  assert.match(read('pages/ConversationTrace.tsx'), /conversation \|\| isKeyOnlySessionKey\(turn\.session_key\)/)
  assert.match(read('pages/useConversationTraces.ts'), /!conversationKey && !isKeyOnlySessionKey\(sessionKey\)/)
  assert.deepEqual(withScheduleName({ sessionKey: 'schedule:x', scopeKind: 'internal' }, new Map([['x', 'n']])), { sessionKey: 'schedule:x', scopeKind: 'internal', sceneLabel: 'n' }, 'a Host kind is kept')
})
