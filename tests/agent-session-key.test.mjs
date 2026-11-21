import test from 'node:test'
import assert from 'node:assert/strict'
import { agentSessionsPath, parseSessionKeyFromQuery, isLikelySessionKey, parseImSessionKey } from '../console-ui/src/utils/agent-session.ts'

test('session deep links round-trip literal percent sequences and reserved characters once', () => {
  for (const scene of ['fake%2Fscene', 'fake%25scene', 'room:thread', 'a/b?c#d', '会话']) {
    const key = `terminal:fixture:private:${scene}`
    const url = new URL(agentSessionsPath(key), 'http://localhost')
    assert.equal(parseSessionKeyFromQuery(url.searchParams.get('sessionKey')), key)
    assert.equal(parseImSessionKey(key).sceneId, scene)
  }
})
test('empty identity segments and unknown scopes are rejected without narrowing scene IDs', () => {
  for (const key of ['', 'invalid', ':fixture:private:user', 'terminal::private:user', 'terminal:fixture:private:', 'terminal:fixture:unknown:user']) {
    assert.equal(isLikelySessionKey(key), false)
    assert.equal(parseImSessionKey(key), null)
  }
  for (const scope of ['private', 'group', 'channel']) assert.equal(isLikelySessionKey(`terminal:fixture:${scope}:room:thread`), true)
})

test('hashed keys of every kind and schedule:<id> are session keys; their deep link selects them', () => {
  const keys = [`personal-session:v1:${'a'.repeat(64)}`, `scene-task:v1:${'9f8e7d6c'.repeat(8)}`, `other-kind:v2:${'b'.repeat(16)}`, 'schedule:sched_mwio9qd6_k2p8x']
  for (const key of keys) {
    assert.equal(isLikelySessionKey(key), true, key)
    assert.equal(parseImSessionKey(key), null, key)
    const url = new URL(agentSessionsPath(key), 'http://localhost')
    assert.equal(parseSessionKeyFromQuery(url.searchParams.get('sessionKey')), key)
  }
  for (const key of ['personal-session:v1:incomplete', `personal-session:v1:${'a'.repeat(32)}`, `scene-task:v1:${'a'.repeat(8)}`, 'schedule:', 'scene-task:v1:XYZ']) assert.equal(isLikelySessionKey(key), false, key)
})

test('session keys are the protocol grammar; the Console still needs an account to name a conversation', async () => {
  const { formatConversationSessionKey, parseConversationSessionKey } = await import('@zhin.js/console-protocol')
  const { buildSessionKey } = await import('../console-ui/src/utils/agent-session.ts')
  const { sessionConversationScope } = await import('../console-ui/src/pages/scope/records-model.mjs')
  assert.equal(buildSessionKey('qq', '10001', 'group', 'room:1'), formatConversationSessionKey({ adapter: 'qq', endpointKey: '10001', kind: 'group', id: 'room:1' }))
  assert.deepEqual(parseImSessionKey(' qq:10001:group:room:1 '), { platform: 'qq', endpointId: '10001', scope: 'group', sceneId: 'room:1' })
  // Behaviour difference (#1250 b80): the protocol accepts an empty account (`resolveIMSceneSessionId`
  // writes `qq::private:1` for a scene without one). The Console keeps reading it as no conversation:
  // there is no account page or chat tab to open for it.
  assert.deepEqual({ ...parseConversationSessionKey('qq::private:1') }, { adapter: 'qq', endpointKey: '', kind: 'private', id: '1' })
  assert.equal(parseImSessionKey('qq::private:1'), null)
  assert.equal(isLikelySessionKey('qq::private:1'), false)
  assert.equal(sessionConversationScope('qq::private:1'), null)
  // Whitespace-only segments and unknown kinds stay rejected on top of the protocol's checks.
  for (const key of ['qq: :private:1', ' :e:private:1', 'qq:e:private: ', 'qq:e:room:1']) assert.equal(parseImSessionKey(key), null, key)
})
