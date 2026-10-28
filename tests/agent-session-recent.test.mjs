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
