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
