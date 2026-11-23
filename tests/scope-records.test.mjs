import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import {
  ASSOCIATION_LABELS, RECORD_SOURCE_COPY, auditEntriesForTarget, auditTargetOf, conversationSessionKey,
  recordSources, scopeSessionRecords, sessionConversationScope, sessionKeyInScope, sessionRowInScope, sessionRowOrigin, sessionsHref,
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

// #64 `scope-records-says-no-history`: hashed session keys (`scene-task:v1:<sha>`) never matched a scope,
// so an account that handled many group turns said 「还没有聊天记录」.
const sha = c => c.repeat(64)
const session = (key, extra = {}) => ({ session_key: key, turns: 3, last_started_at: 1_000, last_status: 'completed', ...extra })
const body = rows => ({ success: true, data: rows })
const icqq = { level: 'endpoint', adapter: 'icqq', endpoint: 'bot' }

test('records match the recorded origin first, an old-style key second', () => {
  const origin = { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: '20001',
    conversation: { endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'group', id: '20001', name: '发布协调群' } }
  assert.deepEqual(sessionRowOrigin(session(`scene-task:v1:${sha('a')}`, { origin })),
    { im: true, adapter: 'icqq', endpoint: 'bot', kind: 'group', id: '20001', name: '发布协调群' })
  assert.deepEqual(sessionRowOrigin(session('x', { origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'private', sceneId: 'private:9' } })),
    { im: true, adapter: 'icqq', endpoint: 'bot', kind: 'private', id: '9' }, 'scope + sceneId without a conversation')
  assert.deepEqual(sessionRowOrigin(session('x', { platform: 'icqq' })), { im: true, adapter: 'icqq' }, 'a top-level platform')
  assert.deepEqual(sessionRowOrigin(session('schedule:1', { origin: { kind: 'schedule', jobId: '1' } })), { im: false })
  assert.equal(sessionRowOrigin(session(`scene-task:v1:${sha('a')}`)), null, 'today\'s Hosts record nothing')

  const conv = { level: 'conversation', adapter: 'icqq', endpoint: 'bot', kind: 'group', id: '20001' }
  assert.equal(sessionRowInScope(session(`scene-task:v1:${sha('a')}`, { origin }), icqq), 'in')
  assert.equal(sessionRowInScope(session(`scene-task:v1:${sha('a')}`, { origin }), conv), 'in')
  assert.equal(sessionRowInScope(session(`scene-task:v1:${sha('a')}`, { origin }), { ...icqq, endpoint: 'other' }), 'out')
  assert.equal(sessionRowInScope(session('x', { platform: 'icqq' }), { level: 'adapter', adapter: 'icqq' }), 'in')
  assert.equal(sessionRowInScope(session('x', { platform: 'icqq' }), icqq), 'unknown', 'a platform alone cannot place it on an account')
  assert.equal(sessionRowInScope(session('icqq:bot:private:9'), icqq), 'in', 'old-style keys still match')
  assert.equal(sessionRowInScope(session('icqq:bot2:private:9'), icqq), 'out')
  assert.equal(sessionRowInScope(session(`scene-task:v1:${sha('b')}`), icqq), 'unknown')
  assert.equal(sessionRowInScope(session(`personal-session:v1:${sha('c')}`), icqq), 'unknown')
  assert.equal(sessionRowInScope(session('schedule:job-1'), icqq), 'out', 'a scheduled task is no IM conversation')
  assert.equal(sessionRowInScope(session(`scene-task:v1:${sha('b')}`), global), 'in')
  assert.equal(sessionRowInScope(session('schedule:job-1'), global), 'out')
})

test('records tell 「truly empty」 apart from 「cannot tell which account」', () => {
  assert.deepEqual(scopeSessionRecords(body([]), icqq), { state: 'empty', rows: [], total: 0, unattributed: 0 })
  assert.equal(scopeSessionRecords({ success: false }, icqq).state, 'empty')
  assert.equal(scopeSessionRecords(body([session('telegram:x:private:1'), session('schedule:1')]), icqq).state, 'empty', 'every session is known to be elsewhere')
  // The owner's case: 70+ group turns under hashed keys, no origin recorded.
  const hashed = [session(`scene-task:v1:${sha('a')}`, { turns: 70 }), session(`scene-task:v1:${sha('b')}`), session(`personal-session:v1:${sha('c')}`)]
  assert.deepEqual(scopeSessionRecords(body(hashed), icqq), { state: 'unattributed', rows: [], total: 0, unattributed: 3 })

  const origin = { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: '20001' }
  const mixed = scopeSessionRecords(body([...hashed, session('icqq:bot:private:9', { last_started_at: 500 }),
    session(`scene-task:v1:${sha('d')}`, { origin, last_started_at: 2_000 }), session(`scene-task:v1:${sha('d')}`, { origin, last_started_at: 1_500, turns: 1 })]), icqq, 8)
  assert.equal(mixed.state, 'matched')
  assert.equal(mixed.unattributed, 3, 'the rest is still counted so the page can say so')
  assert.deepEqual(mixed.rows.map(row => [row.sessionKey, row.turns]), [[`scene-task:v1:${sha('d')}`, 3], ['icqq:bot:private:9', 3]], 'newest first, one row per session')
  assert.deepEqual(mixed.rows[0].conversation, { level: 'conversation', adapter: 'icqq', endpoint: 'bot', kind: 'group', id: '20001' }, 'an origin row can be continued')
  assert.deepEqual(mixed.rows[1].conversation, sessionConversationScope('icqq:bot:private:9'))
  assert.equal(scopeSessionRecords(body(hashed), icqq, 1).rows.length, 0)
  assert.equal(scopeSessionRecords(body(hashed), global).state, 'matched', '全局 lists every conversation')
})

test('the records panel words each empty state and translates it', async () => {
  const panel = await readFile(new URL('../console-ui/src/pages/scope/records-panel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /sessions\.state === 'unattributed'/)
  assert.match(panel, /<Link to=\{CONSOLE_PATHS\.agentSessions\}>\{i18n\.t\('查看全部会话'\)\}<\/Link>/)
  for (const message of ['没找到能对应到这个适配器的会话', '没找到能对应到这个账号的会话', '没找到能对应到这个会话的聊天记录', '查看全部会话']) {
    assert.ok(panel.includes(`'${message}'`), message)
    assert.notEqual(translate('en', message), message, message)
  }
  assert.equal(translate('en', '现在的会话记录没有写明来自哪个账号（需要更新的 Host），{0} 个会话无法确定是否属于这里。可以在「会话 → 聊天记录」查看全部会话。', [2]),
    'Current session records don\'t say which account they came from (that needs a newer Host), so 2 sessions can\'t be placed here. See every session in "Conversation → Chat history".')
  assert.equal(translate('en', '另有 {0} 个会话的记录没有写明来自哪个账号，没有列在这里。', [1]), '1 more session doesn\'t say which account it came from and isn\'t listed here.')
})
