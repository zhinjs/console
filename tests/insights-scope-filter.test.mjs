import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ambientGroupKey, ambientSettingsHref, clearScopeFilter, logScopeTokens, logServerQuery, matchesLogScope, readScopeFilter,
  replayScopeApproximate, replayScopeFilter, scopeFilterHref, scopeFilterParams, usageSessionPattern,
} from '../console-ui/src/pages/insights/scope-filter.mjs'

const params = query => new URLSearchParams(query)

test('the range is read from adapter / endpoint / conversation, each level needing its parent', () => {
  assert.deepEqual(readScopeFilter(params('')), { active: false, scope: { level: 'global' }, identity: '' })
  const conversation = readScopeFilter(params('adapter=qq&endpoint=bot-1&conversation=group%3A123'))
  assert.equal(conversation.active, true)
  assert.deepEqual(conversation.scope, { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'group', id: '123' })
  assert.equal(conversation.identity, 'qq / bot-1 / group:123')
  // An endpoint without its adapter, or a conversation without its account, is ignored.
  assert.equal(readScopeFilter(params('endpoint=bot-1&conversation=group:1')).active, false)
  assert.equal(readScopeFilter(params('adapter=qq&conversation=group:1')).scope.level, 'adapter')
  // Ids may contain `/` and `:` once decoded.
  assert.equal(readScopeFilter(params(`adapter=qq&endpoint=b&conversation=${encodeURIComponent('channel:a/b:c')}`)).scope.id, 'a/b:c')
  const invalid = readScopeFilter(params('adapter=qq&endpoint=bot-1&conversation=nonsense'))
  assert.equal(invalid.scope.level, 'endpoint')
  assert.equal(invalid.invalid, 'nonsense')
})

test('range links round-trip and clearing keeps unrelated parameters', () => {
  const scope = { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'group', id: 'a/b' }
  const href = scopeFilterHref('/logs', scope, { level: 'error', empty: '' })
  assert.equal(href, '/logs?adapter=qq&endpoint=bot-1&conversation=group%3Aa%2Fb&level=error')
  assert.deepEqual(readScopeFilter(new URL(href, 'http://x').searchParams).scope, scope)
  assert.equal(scopeFilterParams({ level: 'adapter', adapter: 'qq' }).toString(), 'adapter=qq')
  assert.equal(scopeFilterHref('/logs', { level: 'global' }), '/logs')
  assert.equal(clearScopeFilter(params('adapter=qq&endpoint=b&conversation=group:1&level=warn&page=3')).toString(), 'level=warn')
})

test('logs match the range by text: the most specific id goes to the Host, every id must appear', () => {
  const scope = { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'group', id: '123' }
  assert.deepEqual(logScopeTokens(scope), ['123', 'bot-1', 'qq'])
  assert.deepEqual(logScopeTokens({ level: 'global' }), [])
  assert.equal(logServerQuery('', scope), '123')
  assert.equal(logServerQuery('  timeout ', scope), 'timeout', 'typed text wins; the range still narrows on the page')
  assert.equal(logServerQuery('', { level: 'global' }), '')
  const tokens = logScopeTokens(scope)
  assert.equal(matchesLogScope({ message: 'send to group 123 failed', source: 'QQ', name: 'bot-1' }, tokens), true)
  assert.equal(matchesLogScope({ message: 'send to group 123 failed', source: 'telegram' }, tokens), false)
  assert.equal(matchesLogScope({ message: 'anything' }, []), true)
})

test('replay, token usage and ambient translate the range into their own filters', () => {
  const conversation = { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'group', id: '123' }
  const endpoint = { level: 'endpoint', adapter: 'qq', endpoint: 'bot-1' }
  assert.deepEqual(replayScopeFilter(conversation), { platform: 'qq', sceneId: 'group:123' })
  assert.deepEqual(replayScopeFilter(endpoint), { platform: 'qq' })
  assert.deepEqual(replayScopeFilter({ level: 'global' }), {})
  assert.equal(replayScopeApproximate(endpoint), true)
  assert.equal(replayScopeApproximate(conversation), false)
  assert.equal(usageSessionPattern(conversation), 'qq:bot-1:group:123')
  assert.equal(usageSessionPattern(endpoint), 'qq:bot-1:*')
  assert.equal(usageSessionPattern({ level: 'adapter', adapter: 'qq' }), 'qq:*')
  assert.equal(usageSessionPattern({ level: 'global' }), '')
  assert.equal(ambientGroupKey(conversation), 'qq:123')
  assert.equal(ambientGroupKey({ ...conversation, kind: 'private' }), null)
  assert.equal(ambientSettingsHref(conversation), '/features/ai/ambient?adapter=qq&endpoint=bot-1&conversation=group%3A123')
  assert.equal(ambientSettingsHref(endpoint), null)
})

test('pages that read the range use the shared filter', () => {
  const read = path => readFileSync(new URL(`../console-ui/src/pages/${path}`, import.meta.url), 'utf8')
  for (const page of ['bot-replay.tsx', 'token-usage.tsx', 'ambient-engagement.tsx']) {
    const source = read(page)
    assert.match(source, /useScopeFilter\(\)/, page)
    assert.match(source, /<ScopeFilterBar/, page)
  }
  // The log viewer is shared by /logs (URL) and the bottom log panel (memory), so it reads the range from its params prop
  // with the same parser useScopeFilter() uses, and clears it through onParamsChange rather than the URL.
  const viewer = read('logs/LogViewer.tsx')
  assert.match(viewer, /readScopeFilter\(params\)/)
  assert.match(viewer, /<ScopeFilterBar/)
  assert.match(viewer, /onClear=\{\(\) => commitParams\(clearScopeFilter\(paramsRef\.current\)\)\}/)
  assert.match(viewer, /logServerQuery\(textFilter, scopeFilter\.scope\)/)
  assert.match(read('bot-replay.tsx'), /replayScopeFilter\(scopeFilter\.scope\)/)
  assert.match(read('token-usage.tsx'), /usageSessionPattern\(scopeFilter\.scope\)/)
  assert.match(read('ambient-engagement.tsx'), /ambientGroupKey\(scopeFilter\.scope\)/)
})
