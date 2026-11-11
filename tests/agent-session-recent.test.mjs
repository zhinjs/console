import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecentSessions, relativeSince } from '../console-ui/src/pages/agent-session-recent.mjs'

test('Host trace sessions become newest-first recent conversations', () => {
  const body = { success: true, data: [
    { session_key: 'icqq:1:group:100', turns: 3, last_started_at: 10, last_status: 'completed', total_tokens: 9 },
    { session_key: 'qq:2:private:u', turns: 1, last_started_at: 30, last_status: 'failed', total_tokens: 1 },
    { session_key: 'icqq:1:group:100', turns: 2, last_started_at: 5, last_status: 'completed' },
  ] }
  assert.deepEqual(readRecentSessions(body).map(row => [row.sessionKey, row.turns]), [['qq:2:private:u', 1], ['icqq:1:group:100', 3]])
  assert.equal(readRecentSessions(body)[0].lastStatus, 'failed')
})

test('malformed rows and failed reads never break the picker', () => {
  for (const body of [null, {}, { success: false, data: [] }, { success: true, data: {} }]) assert.deepEqual(readRecentSessions(body), [])
  const body = { success: true, data: [null, { session_key: 'bad' }, { session_key: 'a:b:dm:c', turns: 1, last_started_at: 1 }, { session_key: 'a:b:group:c', turns: -1, last_started_at: 1 }, { session_key: 'a:b:group:c', turns: 2, last_started_at: 'x' }] }
  assert.deepEqual(readRecentSessions(body), [])
  assert.equal(readRecentSessions({ success: true, data: Array.from({ length: 20 }, (_, i) => ({ session_key: `a:b:group:${i}`, turns: 1, last_started_at: i })) }, 5).length, 5)
})

test('recent activity reads as a short past time', () => {
  assert.equal(relativeSince(1000, 1000 + 20_000), '刚刚')
  assert.equal(relativeSince(0, 5 * 60_000), '5 分钟前')
  assert.equal(relativeSince(0, 2 * 3_600_000), '2 小时前')
  assert.equal(relativeSince(0, 3 * 86_400_000, 'en'), '3 days ago')
})


test('full-authorized directories retain valid personal hashes without pretending they are legacy conversation keys', () => {
  const key = `personal-session:v1:${'a'.repeat(64)}`
  const row = { session_key: key, turns: 1, last_started_at: 10, last_status: 'completed' }
  assert.equal(readRecentSessions({ success: true, data: [row] })[0].sessionKey, key)
  assert.deepEqual(readRecentSessions({ success: true, data: [{ ...row, session_key: 'personal-session:v1:incomplete' }] }), [])
})

test('session summary counts every archived session, not only the recent picker slice', async () => {
  const { summarizeRecentSessions } = await import('../console-ui/src/pages/agent-session-recent.mjs')
  const now = Date.UTC(2026, 10, 11, 12)
  const row = (key, turns, hoursAgo, status = 'completed') => ({ session_key: key, turns, last_started_at: now - hoursAgo * 3_600_000, last_status: status })
  const rows = [
    row('icqq:bot:group:g1', 10, 1),
    row('icqq:bot:group:g1', 4, 30),
    row('icqq:bot:private:u1', 3, 2, 'failed'),
    row('telegram:bot:channel:c1', 5, 48),
    row('broken-key', 99, 1),
    ...Array.from({ length: 14 }, (_, i) => row(`sandbox:bot:private:p${i}`, 1, 72)),
  ]
  assert.deepEqual(summarizeRecentSessions({ success: true, data: rows }, now),
    { sessions: 17, turns: 10 + 3 + 5 + 14, active: 2, groups: 2, privates: 15, failed: 1 })
  assert.equal(summarizeRecentSessions({ success: false }, now), null)
  assert.equal(summarizeRecentSessions(null, now), null)
  assert.deepEqual(summarizeRecentSessions({ success: true, data: [] }, now), { sessions: 0, turns: 0, active: 0, groups: 0, privates: 0, failed: 0 })
})
