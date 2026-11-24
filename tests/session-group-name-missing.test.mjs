import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readRecentSessions, sessionsNeedingGroupNames, withGroupNames } from '../console-ui/src/pages/agent-session-recent.mjs'
import { sessionLabel } from '../console-ui/src/utils/session-label.mjs'

// #64 `session-group-name-missing`: some groups in the session list showed only their number, with
// no name — older traces did not record `conversation.name`. Suggested: fall back to the group name
// the adapter has now (the Console can read the group lists) instead of the bare id.
const now = 1_800_000_000_000
const hashed = `scene-task:v1:${'9f8e7d6c'.repeat(8)}`
const body = rows => ({ success: true, data: rows.map((row, index) => ({ turns: 3, last_started_at: now - index, last_status: 'completed', ...row })) })
const names = new Map([['icqq:20001', '产品试验群'], ['icqq:30002', '运维值班群']])

test('a group the record does not name gets the name from the group lists', () => {
  const rows = readRecentSessions(body([
    // Host 1.10: hashed key, the origin names the group but the old trace kept no name.
    { session_key: hashed, platform: 'icqq', scope_kind: 'group', scene_label: '20001', origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group:20001' } },
    // An address key without any name.
    { session_key: 'icqq:bot:group:30002' },
  ]))
  assert.deepEqual(sessionsNeedingGroupNames(rows), true)
  assert.equal(sessionLabel(rows[0]), 'icqq · 群 20001 · 群聊', 'before: only the number')
  const named = withGroupNames(rows, names)
  assert.equal(sessionLabel(named[0]), 'icqq · 群 产品试验群 · 群聊')
  assert.equal(sessionLabel(named[1]), 'icqq · 群 运维值班群')
})

test('a name the record has wins; unknown groups and other kinds stay as they are', () => {
  const rows = readRecentSessions(body([
    { session_key: hashed, platform: 'icqq', scope_kind: 'group', scene_label: '旧名字', origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group:20001' } },
    { session_key: 'icqq:bot:group:40004' },
    { session_key: 'icqq:bot:private:10001' },
    { session_key: 'schedule:daily' },
  ]))
  const named = withGroupNames(rows, names)
  assert.equal(sessionLabel(named[0]), 'icqq · 群 旧名字 · 群聊')
  assert.equal(sessionLabel(named[1]), 'icqq · 群 40004', 'not in any group list: the number stays')
  assert.deepEqual(named.slice(2), rows.slice(2))
  // The recorded conversation name is used when the Host sends one but no scene label.
  const recorded = readRecentSessions(body([{ session_key: hashed, platform: 'icqq', origin: { kind: 'im', conversation: { endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'group', id: '20001', name: '记录里的群名' } } }]))
  assert.equal(sessionLabel(recorded[0]), 'icqq · 群 记录里的群名 · 群聊')
  assert.equal(sessionsNeedingGroupNames(recorded), false, 'nothing to look up: the group lists are not read')
  assert.equal(sessionsNeedingGroupNames(readRecentSessions(body([{ session_key: 'icqq:bot:private:10001' }]))), false)
})

test('the 聊天记录 page reads the group lists only when a group lacks its name, and the picker shows the name', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
  assert.match(page, /useAmbientGroupCatalog\(needGroupNames\)/)
  assert.match(page, /withGroupNames\(/)
  const picker = readFileSync(new URL('../console-ui/src/components/AgentSessionPicker.tsx', import.meta.url), 'utf8')
  assert.match(picker, /activity\?\.sceneLabel \|\| parsed\.sceneId/)
})
