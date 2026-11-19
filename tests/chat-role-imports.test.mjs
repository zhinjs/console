import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CHAT_ROLES_RPC, CHAT_ROLES_RPC_PERMISSIONS } from '@zhin.js/console-protocol'
import {
  CHAT_ROLE_IMPORT_COPY, CHAT_ROLE_IMPORTS_ANCHOR, CHAT_ROLE_IMPORTS_PERMISSION, CHAT_ROLE_IMPORTS_RPC,
  canResolveChatRoleImports, chatRoleImportEffect, chatRoleImportGranted, chatRoleImportIdentity, chatRoleImportOutcomeCopy,
  chatRoleImportResolveRequest, chatRoleImportResolved, chatRoleImportSummary, chatRoleImportsHref, chatRoleImportsListRequest,
  chatRoleImportsUnsupported, consoleUserLabel, readChatRoleImportResolve, readChatRoleImports,
} from '../console-ui/src/scope/chat-role-imports-model.mjs'
import { createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'
import { attentionActionPath, attentionLinkLines, normalizeAttentionItem } from '../console-ui/src/pages/attention/attention-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)

const LIST = {
  imported: [], hasGlobalOwner: true,
  pending: [
    { id: 'g1', source: 'icqq.endpoints[0].master', level: 'endpoint', key: 'icqq/preview-community', adapter: 'icqq', userId: '10008', role: 'owner', seenAt: 1_700_000_000_000 },
    { id: 'g2', source: 'ai.trigger.trusted', level: 'global', key: '', adapter: 'icqq', userId: '10009', role: 'trusted', seenAt: 1_700_000_000_000 },
    { id: 'bad-role', source: 'x', level: 'global', key: '', adapter: 'icqq', userId: '1', role: 'admin' },
    { id: 'bad-key', source: 'x', level: 'endpoint', key: 'icqq', adapter: 'icqq', userId: '1', role: 'owner' },
  ],
  personalPending: [
    { id: 'p1', consoleUserId: 'u-alice-0123456789', adapter: 'icqq', userId: '10007', seenAt: 1_700_000_000_000 },
    { id: 'p1', consoleUserId: 'u-dup', adapter: 'icqq', userId: '1', seenAt: 0 },
    { id: '', consoleUserId: 'u-x', adapter: 'icqq', userId: '1' },
  ],
}

test('RPC names and the permission come from the protocol', () => {
  assert.equal(CHAT_ROLE_IMPORTS_RPC.LIST, CHAT_ROLES_RPC.IMPORTS_LIST)
  assert.equal(CHAT_ROLE_IMPORTS_RPC.RESOLVE, CHAT_ROLES_RPC.IMPORTS_RESOLVE)
  assert.equal(CHAT_ROLE_IMPORTS_PERMISSION, CHAT_ROLES_RPC_PERMISSIONS[CHAT_ROLES_RPC.IMPORTS_RESOLVE])
  assert.deepEqual(chatRoleImportsListRequest(), { type: 'chat-roles.imports.list' })
  assert.deepEqual(chatRoleImportResolveRequest('import', 'g1'), { type: 'chat-roles.imports.resolve', decision: 'import', id: 'g1' })
  assert.deepEqual(chatRoleImportResolveRequest('ignore', 'p1'), { type: 'chat-roles.imports.resolve', decision: 'ignore', id: 'p1' })
  assert.throws(() => chatRoleImportResolveRequest('acknowledge', 'g1'))
  assert.throws(() => chatRoleImportResolveRequest('import', ''))
})

test('only a global iam.manage binding may handle imports; adapter or account bindings never count', () => {
  assert.equal(canResolveChatRoleImports(createConsoleAccess(null)), true, 'unrestricted session: the Host decides')
  assert.equal(canResolveChatRoleImports(createConsoleAccess({ permissions: ['iam.manage'] })), true)
  assert.equal(canResolveChatRoleImports(createConsoleAccess({ permissions: ['*'] })), true)
  assert.equal(canResolveChatRoleImports(createConsoleAccess({ permissions: ['iam.view', 'status.view'] })), false)
  const scoped = createConsoleAccess({ permissions: ['status.view'], bindings: [{ scope: { kind: 'adapter', key: 'icqq' }, permissions: ['iam.manage'] }] })
  assert.equal(canResolveChatRoleImports(scoped), false)
})

test('the list keeps personal links first, drops malformed and duplicate rows', () => {
  const { rows, hasGlobalOwner } = readChatRoleImports(LIST)
  assert.equal(hasGlobalOwner, true)
  assert.deepEqual(rows.map(row => row.id), ['p1', 'g1', 'g2'])
  assert.deepEqual(rows[0], { kind: 'personal', id: 'p1', consoleUserId: 'u-alice-0123456789', adapter: 'icqq', userId: '10007', source: 'ai.personalPrincipals', seenAt: 1_700_000_000_000 })
  assert.equal(rows[1].endpoint, 'preview-community')
  assert.deepEqual(readChatRoleImports(null), { rows: [], hasGlobalOwner: false })
  assert.deepEqual(readChatRoleImports({ pending: 'x' }).rows, [])
})

test('each row says what it would do in plain words', () => {
  const [personal, owner, trusted] = readChatRoleImports(LIST).rows
  const users = [{ id: 'u-alice-0123456789', username: 'alice', displayName: '值班同事 Alice' }]
  assert.equal(chatRoleImportIdentity(owner), 'icqq · preview-community · 10008')
  assert.equal(chatRoleImportSummary(personal, zh, users), 'Console 用户 值班同事 Alice → icqq · 10007')
  assert.equal(chatRoleImportSummary(personal, zh), 'Console 用户 #u-alice- → icqq · 10007')
  assert.equal(chatRoleImportSummary(owner, zh), 'icqq · preview-community · 10008 → 所有者（账号 icqq/preview-community）')
  assert.equal(chatRoleImportSummary(trusted, zh), 'icqq · 10009 → 受信任（全局）')
  assert.equal(chatRoleImportSummary(owner, en), 'icqq · preview-community · 10008 → Owner (Account icqq/preview-community)')
  assert.equal(chatRoleImportSummary(personal, en, users), 'Console user 值班同事 Alice → icqq · 10007')
  assert.match(chatRoleImportEffect(personal, zh), /不授予任何角色/u)
  assert.match(chatRoleImportEffect(owner, en), /never lower or remove/u)
  assert.equal(consoleUserLabel('u-bob', [{ id: 'u-bob', username: 'bob', displayName: '' }]), 'bob')
})

test('result statuses map to truthful copy', () => {
  const copy = (payload, kind = 'role') => CHAT_ROLE_IMPORT_COPY[chatRoleImportOutcomeCopy(readChatRoleImportResolve(payload), kind)]
  assert.match(copy({ status: 'imported', result: 'written' }), /授予了这个角色/u)
  assert.match(copy({ status: 'imported', result: 'written' }, 'personal'), /同一个人/u)
  assert.match(copy({ status: 'imported', result: 'upgraded' }), /提升/u)
  assert.match(copy({ status: 'imported', result: 'kept' }), /相同或更高的角色，保持不变/u)
  assert.match(copy({ status: 'imported', result: 'memory' }), /内存/u)
  assert.match(copy({ status: 'imported', result: 'skipped', reason: 'simulated' }), /模拟适配器/u)
  assert.match(copy({ status: 'imported', result: 'skipped', reason: 'unknown-adapter' }), /没有加载/u)
  assert.match(copy({ status: 'imported', result: 'skipped', reason: 'owned-elsewhere' }, 'personal'), /另一个人/u)
  assert.match(copy({ status: 'imported', result: 'skipped' }), /跳过/u)
  assert.match(copy({ status: 'ignored' }), /已忽略/u)
  assert.match(copy({ status: 'unchanged' }), /已经处理过/u)
  assert.equal(chatRoleImportGranted(readChatRoleImportResolve({ status: 'imported', result: 'written' }), 'role'), true)
  assert.equal(chatRoleImportGranted(readChatRoleImportResolve({ status: 'imported', result: 'kept' }), 'role'), false)
  assert.equal(chatRoleImportGranted(readChatRoleImportResolve({ status: 'imported', result: 'written' }), 'personal'), false)
  assert.equal(chatRoleImportGranted(readChatRoleImportResolve({ status: 'ignored' }), 'role'), false)
  for (const message of Object.values(CHAT_ROLE_IMPORT_COPY)) assert.ok(Object.hasOwn(englishMessages, message), message)
})

test('an unknown outcome is settled by re-reading the pending list, never by resending', () => {
  const { rows } = readChatRoleImports(LIST)
  assert.equal(chatRoleImportResolved(rows, 'g1'), false)
  assert.equal(chatRoleImportResolved(rows, 'gone'), true)
})

test('an older Host without chat-roles.imports.* is unsupported, quietly', () => {
  assert.equal(chatRoleImportsUnsupported(new Error('Unknown RPC type: chat-roles.imports.list')), true)
  assert.equal(chatRoleImportsUnsupported(Object.assign(new Error('x'), { details: { serverCode: 'unmapped' } })), true)
  assert.equal(chatRoleImportsUnsupported(Object.assign(new Error('x'), { code: 'unknown_rpc' })), true)
  assert.equal(chatRoleImportsUnsupported(Object.assign(new Error('x'), { details: { httpStatus: 404 } })), true)
  assert.equal(chatRoleImportsUnsupported(Object.assign(new Error('没有 iam.manage 权限'), { details: { httpStatus: 403 } })), false)
  assert.equal(chatRoleImportsUnsupported(new Error('timed out')), false)
})

test('「去处理」 of chat-roles.import-pending lands on the section; 「详情」 lists the people', () => {
  assert.equal(chatRoleImportsHref(), `/scope?tab=roles#${CHAT_ROLE_IMPORTS_ANCHOR}`)
  assert.equal(attentionActionPath('chat-roles.import-pending', '/scope?tab=roles'), '/scope?tab=roles#chat-role-imports')
  assert.equal(attentionActionPath('chat-roles.import-pending', '/scope?tab=roles#elsewhere'), '/scope?tab=roles#elsewhere')
  assert.equal(attentionActionPath('chat-roles.import-pending', '/access'), '/access')
  assert.equal(attentionActionPath('chat-roles.no-owner', '/scope?tab=roles'), '/scope?tab=roles')
  const item = normalizeAttentionItem({
    id: 'chat-roles.import-pending', kind: 'chat-roles.import-pending', severity: 'warning', title: '配置中有 2 条人员名单或身份链接等待确认',
    detail: '', since: new Date().toISOString(), action: { label: '去处理', path: '/scope?tab=roles' }, source: 'chat-roles',
    links: [{ consoleUserId: 'u-alice-0123456789', identities: [{ adapter: 'icqq', userIdTail: '0007' }, { adapter: 'qq', endpoint: 'main', userIdTail: '1234' }] }, { consoleUserId: '', identities: [] }],
  })
  assert.equal(item.action.path, '/scope?tab=roles#chat-role-imports')
  assert.deepEqual(attentionLinkLines(item), ['Console 用户 #u-alice- → icqq · …0007、qq · main · …1234'])
  assert.deepEqual(attentionLinkLines(item, 'en'), ['Console user #u-alice- → icqq · …0007, qq · main · …1234'])
  assert.deepEqual(attentionLinkLines(normalizeAttentionItem({ ...item, links: undefined })), [])
})

test('the section never calls the RPC without a global iam.manage and is wired into the global 角色 tab', async () => {
  const section = await readFile(new URL('../console-ui/src/scope/ChatRoleImportsSection.tsx', import.meta.url), 'utf8')
  assert.match(section, /canResolveChatRoleImports\(access\)/u)
  assert.match(section, /if \(!enabled\) return/u)
  assert.match(section, /persistKey: 'chat-roles:imports'/u)
  assert.match(section, /verifyLabel=\{i18n\.t\('刷新核对'\)\}/u)
  assert.match(section, /disabled=\{busy\}/u)
  const panel = await readFile(new URL('../console-ui/src/scope/ChatRolesPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /scope\.level === 'global' \? <ChatRoleImportsSection/u)
})
