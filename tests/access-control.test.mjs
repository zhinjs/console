import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CONSOLE_PERMISSION_LIST, IAM_RPC, PERMISSION_AREAS, actorLabel, addBinding, areaLabel, auditQuery, bindingInputs, breaksLastOwner,
  copyRoleName, groupCheckState, isGlobalOwner, passwordProblem, permissionGroups, permissionLabel, permissionPlugin, readAuditPage,
  readPluginPermissionCatalog, readRoles, readTokens, readUsers, removeBinding, roleNameProblem, scopeLabel, scopeProblem, togglePermissions,
  tokenExpired, usernameProblem,
} from '../console-ui/src/pages/access/access-model.mjs'
import { IamRequestError, iamErrorKind, readIamReply } from '../console-ui/src/pages/access/iam-request.mjs'
import { ROUTE_PERMISSIONS, buildNavigation } from '../console-ui/src/navigation-sections.mjs'
import { CONSOLE_PATHS } from '../console-ui/src/console-routes.mjs'
import { createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { CONSOLE_PERMISSION_LIST as UPSTREAM_PERMISSION_LIST } from '@zhin.js/console-protocol'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

// The protocol catalog, from the published `@zhin.js/console-protocol`.
const PROTOCOL_PERMISSIONS = [...UPSTREAM_PERMISSION_LIST]

const user = (id, bindings, extra = {}) => ({ id, username: id, displayName: id, disabled: false, bindings, ...extra })
const owner = { role: 'owner', scope: { kind: 'global' } }

test('the local mirror covers exactly the protocol permission catalog and IAM RPC names', () => {
  assert.deepEqual([...CONSOLE_PERMISSION_LIST].sort(), [...PROTOCOL_PERMISSIONS].sort())
  assert.equal(new Set(CONSOLE_PERMISSION_LIST).size, CONSOLE_PERMISSION_LIST.length, 'each permission sits in one area')
  assert.deepEqual(Object.values(IAM_RPC).sort(), [
    'iam.audit.list', 'iam.bindings.set', 'iam.roles.create', 'iam.roles.delete', 'iam.roles.list', 'iam.roles.update',
    'iam.tokens.create', 'iam.tokens.list', 'iam.tokens.revoke', 'iam.users.create', 'iam.users.delete', 'iam.users.disable',
    'iam.users.list', 'iam.users.reset-password', 'iam.users.update',
  ])
})

test('every permission and area has authored copy in both languages', () => {
  for (const permission of CONSOLE_PERMISSION_LIST) {
    assert.notEqual(permissionLabel(permission, zh), permission, permission)
    assert.doesNotMatch(permissionLabel(permission, en), /[㐀-鿿]/, permission)
  }
  for (const area of PERMISSION_AREAS) assert.doesNotMatch(areaLabel(area.id, en), /[㐀-鿿]/, area.id)
  assert.equal(permissionLabel('weather.read', zh), 'weather.read', 'unknown permissions show their name')
})

test('plugin permissions are grouped by plugin when the Host reports them, and absence is tolerated', () => {
  assert.deepEqual(readPluginPermissionCatalog({ roles: [] }), [])
  assert.deepEqual(readPluginPermissionCatalog(null), [])
  const catalog = readPluginPermissionCatalog({ pluginPermissions: [
    { permission: 'weather.read', plugin: 'weather', level: 'read', description: '查看天气' },
    { name: 'weather.manage', plugin: 'weather', level: 'manage' },
    'plugin.rss.operate',
    { permission: 'status.view' },
    { permission: 'weather.read' },
    42,
  ] })
  assert.deepEqual(catalog.map(item => [item.permission, item.plugin, item.level]), [
    ['weather.read', 'weather', 'read'], ['weather.manage', 'weather', 'manage'], ['plugin.rss.operate', 'rss', undefined],
  ], 'core permissions and duplicates are dropped')
  const groups = permissionGroups(catalog, ['status.view', 'calendar.read', 'weather.read'])
  assert.deepEqual(groups.filter(group => group.kind === 'area').map(group => group.id), PERMISSION_AREAS.map(area => area.id))
  assert.deepEqual(groups.filter(group => group.kind === 'plugin').map(group => [group.id, group.permissions.map(item => item.permission)]), [
    ['calendar', ['calendar.read']], ['rss', ['plugin.rss.operate']], ['weather', ['weather.manage', 'weather.read']],
  ], 'a plugin permission held by a role shows even when the catalog does not list it')
  assert.equal(permissionPlugin('plugin:root/x:read'), 'root/x')
})

test('checklist toggles single permissions and whole groups', () => {
  assert.deepEqual(togglePermissions(['b'], ['a', 'c'], true), ['a', 'b', 'c'])
  assert.deepEqual(togglePermissions(['a', 'b', 'c'], ['a', 'c'], false), ['b'])
  assert.equal(groupCheckState([], ['a', 'b']), false)
  assert.equal(groupCheckState(['a'], ['a', 'b']), 'indeterminate')
  assert.equal(groupCheckState(['a', 'b', 'x'], ['a', 'b']), true)
})

test('binding scopes follow the protocol rules and serialize to the Host input', () => {
  assert.equal(scopeProblem('global', '', zh), null)
  assert.equal(scopeProblem('adapter', 'qq', zh), null)
  assert.ok(scopeProblem('adapter', 'qq/1', zh))
  assert.ok(scopeProblem('adapter', '', zh))
  assert.ok(scopeProblem('adapter', ' qq', zh))
  assert.equal(scopeProblem('endpoint', 'qq/123', zh), null)
  for (const bad of ['qq', '/123', 'qq/', '']) assert.ok(scopeProblem('endpoint', bad, zh), bad)
  const bindings = [owner, { role: 'operator', scope: { kind: 'adapter', key: 'qq' } }, { role: 'viewer', scope: { kind: 'endpoint', key: 'qq/1' } }]
  assert.deepEqual(bindingInputs(bindings), [
    { role: 'owner', scopeKind: 'global' }, { role: 'operator', scopeKind: 'adapter', scopeKey: 'qq' }, { role: 'viewer', scopeKind: 'endpoint', scopeKey: 'qq/1' },
  ])
  assert.equal(addBinding(bindings, { role: 'owner', scope: { kind: 'global' } }), bindings, 'duplicates are not added')
  assert.equal(addBinding(bindings, { role: 'owner', scope: { kind: 'adapter', key: 'qq' } }).length, 4)
  assert.deepEqual(removeBinding(bindings, 1).map(item => item.role), ['owner', 'viewer'])
  assert.equal(scopeLabel({ kind: 'adapter', key: 'qq' }, en), 'Adapter qq')
  assert.equal(scopeLabel({ kind: 'global' }, zh), '全局')
})

test('last-owner warnings mirror the Host invariant without replacing it', () => {
  const users = [user('a', [owner]), user('b', [{ role: 'admin', scope: { kind: 'global' } }]), user('c', [owner], { disabled: true })]
  assert.equal(isGlobalOwner(users[0]), true)
  assert.equal(isGlobalOwner(users[2]), false, 'a disabled owner does not count')
  assert.equal(breaksLastOwner(users, 'a', { disable: true }), true)
  assert.equal(breaksLastOwner(users, 'a', { remove: true }), true)
  assert.equal(breaksLastOwner(users, 'a', { bindings: [{ role: 'owner', scope: { kind: 'adapter', key: 'qq' } }] }), true, 'an adapter-scoped owner is not a global owner')
  assert.equal(breaksLastOwner(users, 'a', { bindings: [owner] }), false)
  assert.equal(breaksLastOwner(users, 'b', { remove: true }), false)
  assert.equal(breaksLastOwner([...users, user('d', [owner])], 'a', { remove: true }), false)
})

test('Host replies are read defensively', () => {
  const users = readUsers({ users: [
    { id: 'u1', username: 'alice', displayName: 'Alice', disabled: false, createdAt: 1, updatedAt: 2, passwordChangedAt: 3,
      bindings: [{ id: 'b1', roleId: 'builtin:owner', role: 'owner', scope: { kind: 'global' } }, { role: 'viewer', scope: { kind: 'bogus' } }] },
    { id: 'u2', username: 'bob' },
    { username: 'nobody' },
  ] })
  assert.deepEqual(users.map(item => [item.username, item.displayName, item.bindings.length]), [['alice', 'Alice', 1], ['bob', 'bob', 0]])
  assert.deepEqual(readUsers({}), [])
  const roles = readRoles({ roles: [
    { id: 'r1', name: 'support', builtin: false, permissions: ['endpoint.view'] },
    { id: 'builtin:viewer', name: 'viewer', builtin: true, permissions: ['status.view'] },
    { id: 'builtin:owner', name: 'owner', builtin: true, permissions: PROTOCOL_PERMISSIONS },
    { id: 'r0', name: 'auditor', builtin: false, permissions: 'nope' },
  ] })
  assert.deepEqual(roles.map(role => role.name), ['owner', 'viewer', 'auditor', 'support'], 'built-ins first in ADR order')
  assert.deepEqual(roles[2].permissions, [])
  const tokens = readTokens({ tokens: [{ id: 't1', userId: 'u1', name: 'ci', permissions: null, expiresAt: 10, lastUsedAt: null, createdAt: 1 }, { id: 't2', userId: 'u1', name: 'x', permissions: ['status.view'], expiresAt: null }] })
  assert.equal(tokens[0].permissions, null)
  assert.deepEqual(tokens[1].permissions, ['status.view'])
  assert.equal(tokenExpired(tokens[0], 11), true)
  assert.equal(tokenExpired(tokens[1], 11), false)
  const page = readAuditPage({ entries: [{ id: 'e1', at: 5, actor: 'user:u1', action: 'auth.login', outcome: 'ok', target: null, detail: null, ip: '::1' }, { id: 'e2' }], next: 5 })
  assert.equal(page.entries.length, 1)
  assert.equal(page.next, 5)
  assert.equal(readAuditPage({ entries: [] }).next, null)
  const byId = new Map(users.map(item => [item.id, item]))
  assert.equal(actorLabel('user:u1', byId, zh), 'alice')
  assert.equal(actorLabel('user:gone', byId, zh), 'user:gone')
  assert.equal(actorLabel('bootstrap', byId, en), 'Bootstrap token')
  assert.equal(actorLabel('api-token:t1', byId, en), 'API token t1')
})

test('audit filters send exact matches, a time range and the pagination cursor', () => {
  assert.deepEqual(auditQuery(), { limit: 50 })
  const query = auditQuery({ actor: ' user:u1 ', action: 'auth.login', since: '2026-11-01T00:00', until: '' }, 123)
  assert.equal(query.actor, 'user:u1')
  assert.equal(query.action, 'auth.login')
  assert.equal(query.since, new Date('2026-11-01T00:00').getTime())
  assert.equal(query.until, undefined)
  assert.equal(query.before, 123)
  assert.equal(auditQuery({ since: 'not a date' }).since, undefined)
})

test('form checks match the Host rules', () => {
  assert.equal(usernameProblem('Alice.B', zh), null, 'usernames are lowercased by the Host')
  assert.ok(usernameProblem('a', zh))
  assert.ok(usernameProblem('-alice', zh))
  assert.ok(passwordProblem('short', undefined, zh))
  assert.ok(passwordProblem('0123456789', '012345678x', zh))
  assert.equal(passwordProblem('0123456789', '0123456789', zh), null)
  const roles = [{ name: 'support' }, { name: 'owner-copy' }]
  assert.equal(roleNameProblem('auditor', roles, zh), null)
  assert.ok(roleNameProblem('support', roles, zh))
  assert.ok(roleNameProblem('1abc', roles, zh))
  assert.equal(copyRoleName('owner', roles), 'owner-copy-2')
  assert.equal(copyRoleName('viewer', roles), 'viewer-copy')
})

test('IAM replies keep the Host error code; last-owner and old Hosts get their own message', () => {
  assert.deepEqual(readIamReply(200, { success: true, data: { users: [] } }, zh), { users: [] })
  const fail = (status, body) => { try { readIamReply(status, body, en); return null } catch (error) { return error } }
  const lastOwner = fail(409, { success: false, code: 'last_owner', error: '不能移除最后一个所有者' })
  assert.ok(lastOwner instanceof IamRequestError)
  assert.equal(iamErrorKind(lastOwner), 'last_owner')
  assert.match(lastOwner.message, /last owner/)
  assert.equal(lastOwner.hostMessage, '不能移除最后一个所有者')
  const old = fail(400, { success: false, error: 'Unknown RPC type: iam.users.list' })
  assert.equal(iamErrorKind(old), 'unsupported')
  assert.equal(iamErrorKind(fail(403, { success: false, error: 'Forbidden' })), 'forbidden')
  assert.equal(iamErrorKind(fail(503, { success: false, code: 'unavailable', error: '数据库尚未就绪' })), 'unavailable')
  const conflict = fail(409, { success: false, code: 'conflict', error: '用户名已存在' })
  assert.equal(conflict.message, '用户名已存在', 'other Host messages are shown as sent')
  assert.equal(fail(500, null).message, 'Request failed (HTTP 500)')
  assert.equal(iamErrorKind(new Error('x')), 'failed')
})

test('the four access pages live in 访问控制 and need iam.view', () => {
  const paths = [CONSOLE_PATHS.accessUsers, CONSOLE_PATHS.accessRoles, CONSOLE_PATHS.accessTokens, CONSOLE_PATHS.accessAudit]
  assert.deepEqual(paths, ['/access/users', '/access/roles', '/access/tokens', '/access/audit'])
  for (const path of paths) assert.deepEqual(ROUTE_PERMISSIONS[path], ['iam.view'])
  const pages = paths.map((path, order) => ({ path, meta: { group: '访问控制', order } }))
  const section = access => buildNavigation(pages, createConsoleAccess({ permissions: access })).flatMap(tier => tier.sections).map(item => item.id)
  assert.deepEqual(section(['iam.view']), ['access'])
  assert.deepEqual(section(['status.view', 'ops.database.read']), [], 'admins without iam.view do not see the section')
  assert.deepEqual(section(['iam.manage']), [], 'listing needs iam.view')
})

test('every write is gated by iam.manage and destructive ones are confirmed', () => {
  for (const page of ['users', 'roles', 'tokens']) {
    const source = read(`pages/access/${page}.tsx`)
    assert.match(source, /useCanManageIam\(\)/, page)
    assert.match(source, /<ReadOnlyNotice \/>/, page)
    assert.match(source, /<ConfirmDialog|danger: true/, `${page} confirms destructive actions`)
  }
  const users = read('pages/access/users.tsx')
  assert.match(users, /confirmText=\{pending\.user\.username\}/, 'deleting a user needs the typed username')
  assert.match(users, /IAM_RPC\.USERS_DISABLE[\s\S]*danger: true/, 'disabling goes through a danger receipt')
  assert.match(users, /IAM_RPC\.USERS_UPDATE, \{ id: user\.id, displayName/, 'the display name is editable (iam.users.update)')
  const tokens = read('pages/access/tokens.tsx')
  assert.match(tokens, /IAM_RPC\.TOKENS_CREATE, \{ userId/, 'tokens can be issued for a user (iam.tokens.create)')
  assert.match(tokens, /IAM_RPC\.TOKENS_REVOKE[\s\S]*danger: true/, 'revoking goes through a danger receipt')
  const roles = read('pages/access/roles.tsx')
  assert.match(roles, /canManage && !role\.builtin/, 'built-in roles cannot be deleted from the UI')
  assert.match(roles, /role\.builtin \|\| !canManage/, 'built-in roles open read-only')
  // The shared transport drops Host error codes; access pages must read the envelope themselves.
  for (const page of ['users', 'roles', 'tokens', 'audit']) assert.doesNotMatch(read(`pages/access/${page}.tsx`), /requestConsole/, page)
})
