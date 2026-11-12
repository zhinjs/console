import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SCOPE_TAB, SCOPE_TAB_LABELS, SCOPE_TAB_PERMISSIONS, SCOPE_TABS, parentScope, parseScopeKey, parseScopeParams, parseScopePath,
  resolveScopeTab, sameScope, scopeChain, scopeCrumbs, scopeHref, scopeIdentity, scopeKey, scopeLevel, scopePickerTree,
} from '../console-ui/src/scope/scope-tree.mjs'
import { CONSOLE_PATHS, resolveLegacyRedirect } from '../console-ui/src/console-routes.mjs'
import { ROUTE_PERMISSIONS } from '../console-ui/src/navigation-sections.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const conversation = (id, kind = 'group') => ({ level: 'conversation', adapter: 'qq', endpoint: '10001', kind, id })

test('levels follow the fields a scope has, and each level has its own tabs in a fixed order', () => {
  assert.equal(scopeLevel(undefined), 'global')
  assert.equal(scopeLevel({}), 'global')
  assert.equal(scopeLevel({ adapter: 'qq' }), 'adapter')
  assert.equal(scopeLevel({ adapter: 'qq', endpoint: 'b' }), 'endpoint')
  assert.equal(scopeLevel({ adapter: 'qq', endpoint: 'b', kind: 'group' }), 'endpoint', 'a kind without an id is not a conversation')
  assert.equal(scopeLevel(conversation('9')), 'conversation')
  assert.deepEqual(SCOPE_TABS.global, ['overview', 'features', 'roles', 'records'])
  assert.deepEqual(SCOPE_TABS.adapter, ['overview', 'features', 'roles', 'records'])
  assert.deepEqual(SCOPE_TABS.endpoint, ['overview', 'chat', 'access', 'features', 'roles', 'records'])
  assert.deepEqual(SCOPE_TABS.conversation, ['overview', 'chat', 'features', 'roles', 'records'])
  for (const tabs of Object.values(SCOPE_TABS)) {
    assert.equal(tabs[0], DEFAULT_SCOPE_TAB)
    for (const tab of tabs) {
      assert.ok(Object.hasOwn(englishMessages, SCOPE_TAB_LABELS[tab]), `${tab} label is translated`)
      assert.ok(SCOPE_TAB_PERMISSIONS[tab].length, `${tab} declares its permissions`)
    }
  }
  assert.deepEqual(SCOPE_TAB_PERMISSIONS.roles, ['iam.manage'], 'chat-roles.* need iam.manage (ADR 0056)')
})

test('the tab comes from ?tab= only when the level has it', () => {
  assert.equal(resolveScopeTab('endpoint', 'chat'), 'chat')
  assert.equal(resolveScopeTab('endpoint', 'access'), 'access')
  assert.equal(resolveScopeTab('conversation', 'access'), 'overview', 'conversations have no 接入')
  assert.equal(resolveScopeTab('global', 'chat'), 'overview')
  for (const value of [null, undefined, '', 'Chat', 'conversations', 42]) assert.equal(resolveScopeTab('endpoint', value), 'overview', String(value))
})

test('object page paths encode each segment once; the conversation is one <kind>:<id> segment', () => {
  assert.equal(scopeHref(), '/scope')
  assert.equal(scopeHref({}, 'features'), '/scope?tab=features')
  assert.equal(scopeHref({ adapter: 'qq' }), '/scope/qq')
  assert.equal(scopeHref({ adapter: 'root/icqq', endpoint: 'bot:1' }, 'chat'), '/scope/root%2Ficqq/bot%3A1?tab=chat')
  assert.equal(scopeHref(conversation('a/b?#c%d'), 'features'), '/scope/qq/10001/group%3Aa%2Fb%3F%23c%25d?tab=features')
  assert.equal(scopeHref({ adapter: 'qq' }, 'chat'), '/scope/qq', 'a tab the level does not have is dropped')
  assert.equal(scopeHref({ adapter: 'qq' }, 'roles', { tab: 'x', q: '1' }), '/scope/qq?tab=roles&q=1', 'the tab leads; a stray tab parameter is replaced')
  for (const key of ['scope', 'scopeAdapter', 'scopeEndpoint', 'scopeConversation']) assert.ok(ROUTE_PERMISSIONS[CONSOLE_PATHS[key]].length, key)
})

/** What the browser does: the raw pathname of the link, before the router decodes anything. */
const rawPath = href => new URL(href, 'https://console.example').pathname

test('raw object paths parse back to the same scope, including ids with %, /, :, ? and #', () => {
  const ids = ['9', 'a/b', '%', '%2F', 'a%2Fb', 'x?y#z', 'u:1:2', '群 聊', '%25', 'a%']
  for (const id of ids) for (const kind of ['group', 'private', 'channel']) {
    const scope = conversation(id, kind)
    const parsed = parseScopePath(rawPath(scopeHref(scope, 'chat')))
    assert.ok(parsed?.ok, id)
    assert.deepEqual(parsed.scope, scope, `${kind}:${id}`)
    assert.equal(parsed.key, scopeKey(scope))
  }
  for (const endpoint of ['bot', 'a b', 'bot:1', '中文']) {
    const parsed = parseScopePath(rawPath(scopeHref({ adapter: 'qq', endpoint })))
    assert.deepEqual(parsed.scope, { level: 'endpoint', adapter: 'qq', endpoint })
    assert.equal(parsed.key, `qq/${endpoint}`)
  }
  assert.deepEqual(parseScopePath('/scope'), { ok: true, scope: { level: 'global' }, key: '' })
  assert.deepEqual(parseScopePath('/scope/'), { ok: true, scope: { level: 'global' }, key: '' })
  assert.deepEqual(parseScopePath('/scope/qq/'), { ok: true, scope: { level: 'adapter', adapter: 'qq' }, key: 'qq' })
})

test('paths that are not object pages, or a conversation segment that is not <kind>:<id>, are reported', () => {
  for (const path of ['/scopes', '/endpoints', '/scope/a/b/c/d', '/scope//b', '/scope/%E0%A4%A', 42, null]) assert.equal(parseScopePath(path), null, String(path))
  for (const segment of ['room%3A1', 'group', 'group%3A', '%3A1']) {
    const parsed = parseScopePath(`/scope/qq/b/${segment}`)
    assert.equal(parsed.ok, false, segment)
    assert.equal(parsed.reason, 'invalid-conversation')
    assert.deepEqual(parsed.scope, { level: 'endpoint', adapter: 'qq', endpoint: 'b' }, 'the account it belongs to is kept')
  }
  // Router parameters arrive decoded.
  assert.deepEqual(parseScopeParams({ adapter: 'qq', endpoint: 'b', conversation: 'private:u:1' }).scope, { level: 'conversation', adapter: 'qq', endpoint: 'b', kind: 'private', id: 'u:1' })
})

test('resolution keys follow the Host: alias, alias/endpoint, alias/endpoint/kind:<escaped id>', () => {
  assert.equal(scopeKey({}), '')
  assert.equal(scopeKey({ adapter: 'qq' }), 'qq')
  assert.equal(scopeKey({ adapter: 'qq', endpoint: '10001' }), 'qq/10001')
  assert.equal(scopeKey(conversation('a/b%c')), 'qq/10001/group:a%2Fb%25c', 'only % and / are escaped')
  assert.equal(scopeKey(conversation('x:y?#')), 'qq/10001/group:x:y?#')
  // Not addressable by the Host: the page still works, the feature and role tabs explain why not.
  assert.equal(scopeKey({ adapter: 'root/icqq' }), null)
  assert.equal(scopeKey({ adapter: 'QQ' }), null)
  assert.equal(scopeKey({ adapter: 'qq', endpoint: 'a/b' }), null)
  assert.equal(scopeKey({ adapter: 'qq', endpoint: 'a~b' }), null)
  assert.equal(scopeKey(conversation('x'.repeat(257))), null)
  for (const scope of [{}, { adapter: 'qq' }, { adapter: 'qq', endpoint: '10001' }, conversation('a/b%c'), conversation('u:1', 'private')]) {
    const parsed = parseScopeKey(scopeKey(scope))
    assert.ok(sameScope(parsed, scope), JSON.stringify(scope))
  }
  for (const bad of ['QQ', 'qq/', 'qq/a/b', 'qq/a/room:1', 'qq/a/group:a%2', 'qq/a/group:a/b', 7]) assert.equal(parseScopeKey(bad), null, String(bad))
})

test('chains, parents, breadcrumbs and identities run from 全局 down to the scope', () => {
  const scope = conversation('a/b')
  assert.deepEqual(scopeChain(scope).map(item => item.level), ['global', 'adapter', 'endpoint', 'conversation'])
  assert.deepEqual(parentScope(scope), { level: 'endpoint', adapter: 'qq', endpoint: '10001' })
  assert.equal(parentScope({}), null)
  const crumbs = scopeCrumbs(scope, { conversation: '产品群' })
  assert.deepEqual(crumbs.map(crumb => [crumb.level, crumb.label, crumb.href]), [
    ['global', '全局', '/scope'],
    ['adapter', 'qq', '/scope/qq'],
    ['endpoint', '10001', '/scope/qq/10001'],
    ['conversation', '产品群', '/scope/qq/10001/group%3Aa%2Fb'],
  ])
  assert.ok(Object.hasOwn(englishMessages, crumbs[0].label))
  assert.equal(scopeIdentity(scope), 'qq / 10001 / group:a/b')
  assert.equal(scopeIdentity({}), '')
})

test('the picker lists adapters, accounts and the current account\'s conversations, and always shows the current scope', () => {
  const endpoints = [
    { adapter: 'telegram', name: 'support', connected: false },
    { adapter: 'qq', name: 'b', connected: true },
    { adapter: 'qq', name: 'a', connected: true },
    { adapter: '', name: 'bad' },
  ]
  const current = conversation('9')
  const tree = scopePickerTree(endpoints, current, [{ kind: 'group', id: '1', name: '一群' }, { kind: 'room', id: 'x' }, { kind: 'group', id: '1' }])
  assert.deepEqual(tree.map(entry => entry.adapter), ['qq', 'telegram'])
  const qq = tree[0]
  assert.equal(qq.current, true)
  assert.deepEqual(qq.accounts.map(account => [account.endpoint, account.listed, account.current]), [['10001', false, true], ['a', true, false], ['b', true, false]])
  assert.deepEqual(qq.accounts[0].conversations, [{ kind: 'group', id: '1', name: '一群' }, { kind: 'group', id: '9' }], 'bad and duplicate rows are dropped; the current conversation is added')
  assert.deepEqual(qq.accounts[1].conversations, [], 'other accounts do not list conversations')
  assert.equal(scopePickerTree([], {}).length, 0)
})

test('old bookmarks of every merged page land on an object page of the new tree', () => {
  for (const [path, search] of [
    ['/endpoints', ''], ['/endpoints/qq/b', ''], ['/endpoints/qq/b', '?channelType=private&channelId=u%2F1'],
    ['/features/adapters', ''], ['/features/adapters/qq', ''], ['/features/adapters/qq/endpoints/b', ''],
    ['/features/adapters/qq/endpoints/b/conversations/group%3Aa%252F', ''],
  ]) {
    const target = resolveLegacyRedirect(path, search)
    const url = new URL(target, 'https://console.example')
    const parsed = parseScopePath(url.pathname)
    assert.ok(parsed?.ok, `${path}${search} -> ${target}`)
    assert.equal(resolveScopeTab(parsed.scope.level, url.searchParams.get('tab') ?? undefined), url.searchParams.get('tab') ?? 'overview', 'the tab exists on that level')
  }
  const workspace = new URL(resolveLegacyRedirect('/endpoints/qq/b', '?channelType=private&channelId=u%2F1'), 'https://console.example')
  assert.deepEqual(parseScopePath(workspace.pathname).scope, { level: 'conversation', adapter: 'qq', endpoint: 'b', kind: 'private', id: 'u/1' })
  const stored = new URL(resolveLegacyRedirect('/features/adapters/qq/endpoints/b/conversations/group%3Aa%252F', ''), 'https://console.example')
  assert.equal(parseScopePath(stored.pathname).scope.id, 'a%2F', 'an id that contains %2F survives the redirect')
})
