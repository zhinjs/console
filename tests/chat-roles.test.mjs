import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_ROLE_COPY, CHAT_ROLE_LABELS, CHAT_ROLE_SOURCE_LABELS, CHAT_ROLES, chatRoleApplied, chatRoleGrantRequest, chatRoleNeedsGlobalManage,
  chatRoleRefusal, chatRoleRevokeRequest, chatRoleRows, chatRolesListRequest, effectiveChatRole, grantableChatRoles, readChatRoleChange, readChatRoles,
} from '../console-ui/src/scope/chat-roles-model.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { readFile } from 'node:fs/promises'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const CONVERSATION = { level: 'conversation', adapter: 'qq', endpoint: '10001', kind: 'group', id: 'a/b' }
const KEY = 'qq/10001/group:a%2Fb'
const entry = (level, key, userId, role, source = 'grant', extra = {}) => ({ level, key, adapter: 'qq', userId, role, source, ...extra })

test('chat-roles.list asks for the scope by level and resolution key', () => {
  assert.deepEqual(chatRolesListRequest({}), { type: 'chat-roles.list', level: 'global' })
  assert.deepEqual(chatRolesListRequest({ adapter: 'qq' }), { type: 'chat-roles.list', level: 'adapter', key: 'qq' })
  assert.deepEqual(chatRolesListRequest(CONVERSATION, { descendants: true }), { type: 'chat-roles.list', level: 'conversation', key: KEY, descendants: true })
  assert.throws(() => chatRolesListRequest({ adapter: 'root/icqq' }), /cannot hold/)
  for (const role of CHAT_ROLES) assert.ok(Object.hasOwn(englishMessages, CHAT_ROLE_LABELS[role]), role)
  for (const label of Object.values(CHAT_ROLE_SOURCE_LABELS)) assert.ok(Object.hasOwn(englishMessages, label), label)
})

test('entries are validated; only grants are zhin roles; rows separate this level, inherited and lower scopes', () => {
  const entries = readChatRoles({ roles: [
    entry('global', '', 'g', 'owner'),
    entry('global', '', 'cfg', 'owner', 'config', { detail: 'ai.trigger.masters' }),
    entry('adapter', 'qq', 'a', 'admin'),
    entry('conversation', KEY, 'c', 'trusted', 'grant', { grantedBy: 'console:owner', grantedAt: 5 }),
    entry('conversation', KEY, 'm', 'admin', 'mapping'),
    entry('conversation', 'qq/10001/group:other', 'x', 'admin'),
    entry('adapter', 'QQ', 'bad', 'admin'),
    entry('endpoint', 'qq', 'bad', 'admin'),
    { ...entry('global', '', 'bad', 'master') },
    { ...entry('global', '', 'bad', 'admin', 'guess') },
    null,
  ] })
  assert.equal(entries.length, 4)
  const rows = chatRoleRows(entries, CONVERSATION)
  assert.deepEqual(rows.map(row => [row.userId, row.relation, row.revocable]), [
    ['c', 'direct', true], ['g', 'inherited', false], ['a', 'inherited', false], ['x', 'below', false],
  ])
  assert.ok(!rows.some(row => row.userId === 'm' || row.userId === 'cfg'), 'platform standing (mapping) and config entries are not zhin roles')
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
  assert.deepEqual(readChatRoles(null), [])
})

test('the effective role is the highest along the chain (owner ⊃ admin ⊃ trusted)', () => {
  const entries = [entry('adapter', 'qq', 'u', 'trusted'), entry('conversation', KEY, 'u', 'admin'), entry('conversation', 'qq/10001/group:z', 'u', 'owner')]
  assert.equal(effectiveChatRole(entries, CONVERSATION, 'qq', 'u'), 'admin', 'a role in another conversation does not count')
  assert.equal(effectiveChatRole(entries, { adapter: 'qq' }, 'qq', 'u'), 'trusted')
  assert.equal(effectiveChatRole(entries, CONVERSATION, 'tg', 'u'), null)
})

test('grant and revoke bodies keep identities on the scope adapter below 全局', () => {
  assert.deepEqual(chatRoleGrantRequest(CONVERSATION, { userId: ' 42 ', role: 'admin' }), { type: 'chat-roles.grant', level: 'conversation', key: KEY, adapter: 'qq', userId: '42', role: 'admin' })
  assert.deepEqual(chatRoleGrantRequest({}, { adapter: 'tg', userId: '1', role: 'owner' }), { type: 'chat-roles.grant', level: 'global', adapter: 'tg', userId: '1', role: 'owner' })
  assert.throws(() => chatRoleGrantRequest(CONVERSATION, { adapter: 'tg', userId: '1', role: 'admin' }), /scope adapter/)
  assert.throws(() => chatRoleGrantRequest({}, { adapter: '', userId: '1', role: 'admin' }), /alias/)
  assert.throws(() => chatRoleGrantRequest({}, { adapter: 'qq', userId: ' ', role: 'admin' }), /User id/)
  assert.throws(() => chatRoleGrantRequest({}, { adapter: 'qq', userId: '1', role: 'master' }), /Role/)
  assert.deepEqual(chatRoleRevokeRequest({ adapter: 'qq', endpoint: '10001' }, { adapter: 'qq', userId: '1' }), { type: 'chat-roles.revoke', level: 'endpoint', key: 'qq/10001', adapter: 'qq', userId: '1' })
  assert.throws(() => chatRoleRevokeRequest({ adapter: 'qq' }, { adapter: 'tg', userId: '1' }))
  assert.deepEqual(readChatRoleChange({ status: 'unchanged' }), { status: 'unchanged' })
})

test('after an unknown outcome a re-read tells whether the grant is stored', () => {
  const stored = [entry('conversation', KEY, '1', 'admin'), entry('conversation', KEY, '2', 'admin', 'mapping')]
  assert.equal(chatRoleApplied(stored, CONVERSATION, { adapter: 'qq', userId: '1', role: 'admin' }, 'grant'), true)
  assert.equal(chatRoleApplied(stored, CONVERSATION, { adapter: 'qq', userId: '1', role: 'owner' }, 'grant'), false)
  assert.equal(chatRoleApplied(stored, CONVERSATION, { adapter: 'qq', userId: '2', role: 'admin' }, 'grant'), false, 'only a stored grant counts')
  assert.equal(chatRoleApplied(stored, CONVERSATION, { adapter: 'qq', userId: '1' }, 'revoke'), false)
  assert.equal(chatRoleApplied(stored, CONVERSATION, { adapter: 'qq', userId: '3' }, 'revoke'), true)
})

test('redacted entries (inherited from a scope the caller does not manage) keep role and level only and are never revocable', () => {
  const redacted = { level: 'global', key: '', role: 'owner', source: 'grant', redacted: true }
  const entries = readChatRoles({ roles: [
    redacted, { ...redacted }, { level: 'adapter', key: 'qq', role: 'admin', source: 'grant', redacted: true },
    { level: 'conversation', key: KEY, role: 'owner', source: 'grant', redacted: true },
    entry('conversation', KEY, 'c', 'admin'),
    { level: 'global', key: '', role: 'owner', source: 'grant' },
    { level: 'global', key: 'qq', role: 'owner', source: 'grant', redacted: true },
  ] })
  assert.equal(entries.length, 5, 'an unredacted entry without identity and a malformed key are dropped')
  assert.deepEqual(entries[0], { level: 'global', key: '', role: 'owner', source: 'grant', redacted: true })
  const rows = chatRoleRows(entries, CONVERSATION)
  assert.deepEqual(rows.map(row => [row.userId ?? null, row.role, row.relation, row.revocable]), [
    [null, 'owner', 'direct', false], ['c', 'admin', 'direct', true], [null, 'owner', 'inherited', false], [null, 'owner', 'inherited', false], [null, 'admin', 'inherited', false],
  ])
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'two identical redacted rows still get distinct keys')
  assert.equal(effectiveChatRole(entries, CONVERSATION, 'qq', 'c'), 'admin', 'a redacted owner is nobody in particular')
  assert.equal(chatRoleApplied(entries, CONVERSATION, { adapter: 'qq', userId: 'x' }, 'revoke'), true)
  assert.ok(Object.hasOwn(englishMessages, CHAT_ROLE_COPY.redacted))
})

test('owner is offered and revocable only with a global iam.manage', () => {
  assert.deepEqual(grantableChatRoles(true), ['owner', 'admin', 'trusted'])
  assert.deepEqual(grantableChatRoles(false), ['admin', 'trusted'])
  assert.equal(chatRoleNeedsGlobalManage('owner'), true)
  assert.equal(chatRoleNeedsGlobalManage('admin'), false)
  assert.ok(Object.hasOwn(englishMessages, CHAT_ROLE_COPY.ownerNeedsGlobal))
})

test('certain refusals of grant / revoke carry their reason; unknown outcomes stay unknown', () => {
  const unpersisted = Object.assign(new Error('聊天角色需要关系型项目数据库'), { details: { httpStatus: 503, serverCode: 'chat-roles-unpersisted' } })
  assert.deepEqual(chatRoleRefusal(statusFromError(unpersisted)), { code: 'unpersisted' })
  assert.ok(Object.hasOwn(englishMessages, CHAT_ROLE_COPY.unpersisted))
  const owner = Object.assign(new Error('授予或撤销 owner 需要全局 iam.manage 权限'), { details: { httpStatus: 403 } })
  assert.deepEqual(chatRoleRefusal(statusFromError(owner)), { code: 'refused', message: '授予或撤销 owner 需要全局 iam.manage 权限' })
  const peer = Object.assign(new Error('不能授予或覆盖与你同级的角色'), { details: { httpStatus: 400 } })
  assert.equal(chatRoleRefusal(statusFromError(peer)).message, '不能授予或覆盖与你同级的角色')
  const timeout = Object.assign(new Error('REST request failed'), { code: 'MESSAGE_ERROR', details: { transport: 'timeout' } })
  assert.equal(chatRoleRefusal(statusFromError(timeout)), null)
  const instance = Object.assign(new Error('instance timeout'), { details: { httpStatus: 504, serverCode: 'instance_timeout', requestOutcome: 'unknown' } })
  assert.equal(chatRoleRefusal(statusFromError(instance)), null)
  assert.equal(chatRoleRefusal(null), null)
})

test('the 角色 tab hides owner without a global iam.manage and shows redacted rows as 上级授予', async () => {
  const source = await readFile(new URL('../console-ui/src/scope/ChatRolesPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /hasConsolePermission\('iam\.manage', access\)/u, 'checked without a scope target: only global bindings count')
  assert.match(source, /grantableChatRoles\(globalManage\)/u)
  assert.match(source, /chatRoleNeedsGlobalManage\(row\.role\) && !globalManage/u)
  assert.match(source, /row\.redacted \?/u)
  assert.match(source, /chatRoleRefusal\(statusFromError\(error\)\)/u)
})
