import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import {
  ASSOCIATION_LABELS, RECORD_SOURCE_COPY, auditEntriesForTarget, auditTargetOf, conversationSessionKey,
  recordSources, sessionConversationScope, sessionKeyInScope, sessionsHref,
} from '../console-ui/src/pages/scope/records-model.mjs'
import { readScopeFilterParams, scopeFilterHref } from '../console-ui/src/pages/insights/scope-filter.mjs'

const global = { level: 'global' }
const adapter = { level: 'adapter', adapter: 'qq' }
const endpoint = { level: 'endpoint', adapter: 'qq', endpoint: 'bot-1' }
const conversation = { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'group', id: 'a/b:1' }
const byId = scope => Object.fromEntries(recordSources(scope).map(source => [source.id, source]))

test('every level links each record page already narrowed to the scope', () => {
  const c = byId(conversation)
  const scopeQuery = `adapter=qq&endpoint=bot-1&conversation=${encodeURIComponent('group:a/b:1')}`
  assert.equal(c.sessions.href, `/agent/sessions?${scopeQuery}&sessionKey=${encodeURIComponent('qq:bot-1:group:a/b:1')}`)
  assert.equal(c.replay.href, `/agent/replay?${scopeQuery}`)
  assert.equal(c.logs.href, `/logs?${scopeQuery}`, 'the shared scope parameters, not a text search')
  assert.equal(c.audit.href, `/access/audit?target=${encodeURIComponent('endpoint:qq/bot-1')}`)
  const e = byId(endpoint)
  assert.equal(e.sessions.href, '/agent/sessions?adapter=qq&endpoint=bot-1')
  assert.equal(e.replay.href, '/agent/replay?adapter=qq&endpoint=bot-1')
  assert.equal(e.audit.href, `/access/audit?target=${encodeURIComponent('endpoint:qq/bot-1')}`)
  assert.equal(byId(adapter).sessions.href, '/agent/sessions?adapter=qq')
  assert.equal(byId(adapter).audit.href, `/access/audit?target=${encodeURIComponent('adapter:qq')}`)
  for (const source of recordSources(global)) {
    assert.equal(source.association, 'all')
    assert.equal(source.filter, '')
    assert.ok(!source.href.includes('?'), `${source.id} is not filtered on 全局`)
  }
})

test('each source says how exact its filter is; nothing is matched by time', () => {
  assert.equal(byId(conversation).sessions.association, 'exact')
  assert.equal(byId(conversation).replay.association, 'partial', 'decisions do not record the account')
  assert.equal(byId(endpoint).replay.association, 'partial')
  assert.equal(byId(adapter).replay.association, 'exact')
  assert.equal(byId(conversation).audit.association, 'partial', 'audit targets stop at the account')
  assert.equal(byId(endpoint).audit.association, 'exact')
  for (const scope of [adapter, endpoint, conversation]) assert.equal(byId(scope).logs.association, 'text')
  for (const scope of [global, adapter, endpoint, conversation]) {
    for (const source of recordSources(scope)) {
      assert.doesNotMatch(source.href, /since|until|before|after/, 'no time window stands in for an association')
      assert.ok(translate('en', source.note) !== source.note, `${source.id}/${scope.level} note is translated`)
    }
  }
  for (const copy of Object.values(RECORD_SOURCE_COPY)) assert.notEqual(translate('en', copy.description), copy.description)
  for (const label of Object.values(ASSOCIATION_LABELS)) assert.notEqual(translate('en', label), label)
})

test('session keys and audit targets are matched exactly', () => {
  assert.equal(conversationSessionKey(conversation), 'qq:bot-1:group:a/b:1')
  assert.equal(sessionKeyInScope('qq:bot-1:group:a/b:1', conversation), true)
  assert.equal(sessionKeyInScope('qq:bot-1:group:a/b:10', conversation), false)
  assert.equal(sessionKeyInScope('qq:bot-1:private:9', endpoint), true)
  assert.equal(sessionKeyInScope('qq:bot-10:private:9', endpoint), false, 'no prefix match on the account id')
  assert.equal(sessionKeyInScope('qqx:bot-1:private:9', adapter), false)
  assert.equal(sessionKeyInScope('5f0c'.repeat(16), adapter), false, 'personal sessions belong to no IM scope')
  assert.equal(sessionKeyInScope('anything', global), true)
  assert.equal(auditTargetOf(global), '')
  const entries = [{ target: 'endpoint:qq/bot-1' }, { target: 'endpoint:qq/bot-10' }, { target: null }]
  assert.deepEqual(auditEntriesForTarget(entries, 'endpoint:qq/bot-1'), [entries[0]])
  assert.equal(auditEntriesForTarget(entries, ''), entries)
})

test('the shared scope parameters round-trip; a child without its parent drops the whole group', () => {
  for (const scope of [adapter, endpoint, conversation]) assert.deepEqual(readScopeFilterParams(new URL(scopeFilterHref('/x', scope, { keep: 1 }), 'http://h').searchParams), scope)
  assert.equal(scopeFilterHref('/logs', global), '/logs')
  assert.equal(readScopeFilterParams(new URLSearchParams('endpoint=bot-1')), null)
  assert.deepEqual(readScopeFilterParams(new URLSearchParams('adapter=qq&conversation=group:1')), adapter, 'a conversation without its account is dropped')
  assert.equal(readScopeFilterParams(new URLSearchParams('adapter=qq&endpoint=b&conversation=room:1')), null, 'a malformed conversation names no scope')
})

test('the sessions page links continuable sessions to their chat', () => {
  assert.equal(sessionsHref(global), '/agent/sessions')
  assert.deepEqual(sessionConversationScope('qq:bot-1:channel:g:1'), { level: 'conversation', adapter: 'qq', endpoint: 'bot-1', kind: 'channel', id: 'g:1' })
  assert.equal(sessionConversationScope('5f0c'.repeat(16)), null, 'a personal session is history only')
  assert.equal(sessionConversationScope('qq:bot-1:room:1'), null)
})

test('the record pages read the scope filter from the URL', async () => {
  const read = path => readFile(new URL(`../console-ui/src/pages/${path}`, import.meta.url), 'utf8')
  const audit = await read('access/audit.tsx')
  assert.match(audit, /searchParams\.get\('target'\)/)
  assert.match(audit, /shown\.map\(entry =>/)
  const sessions = await read('agent-sessions.tsx')
  assert.match(sessions, /readScopeFilterParams\(searchParams\)/)
  assert.match(sessions, /scopeHref\(continueScope, 'chat'\)/)
  const panels = await read('scope/scope-panels.tsx')
  assert.match(panels, /export \{ ScopeRecordsPanel \} from '\.\/records-panel'/)
})
