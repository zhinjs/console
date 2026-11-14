import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_IDENTITY_RPC, LINK_METHOD_LABELS, adapterAliases, bindCountdown, bindInstruction, filterPrincipals, grantCandidates, grantorLabel,
  isMissingIdentityRpc, principalActions, principalName, principalsListRequest, promoteGlobalOwnerRequest, readBindCode, readIdentityMe,
  readPrincipals, readRecentIdentities, recentIdentitiesRequest,
} from '../console-ui/src/scope/chat-identity-model.mjs'
import { readChatRoles } from '../console-ui/src/scope/chat-roles-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const person = (id, identities, roles = [], extra = {}) => ({ id, identities, roles, ...extra })
const qq = (userId, extra = {}) => ({ adapter: 'qq', userId, ...extra })

test('people, recent speakers and `me` are read defensively (ADR 0060 §7)', () => {
  const people = readPrincipals({ principals: [
    person('cp_old', [qq('1', { lastSeenAt: 10, lastDisplayName: '旧' })]),
    person('cp_new', [qq('2', { lastSeenAt: 20, linkMethod: 'code' }), { adapter: 'tg', userId: 't' }],
      [{ level: 'global', key: '', role: 'owner', grantedBy: 'console:user:u1', grantedByName: '老板' }],
      { consoleLink: { consoleUserId: 'u1', consoleDisplayName: 'Boss' }, unverified: true, hiddenIdentities: 2 }),
    { id: 42 }, null,
  ] })
  assert.deepEqual(people.map(item => item.id), ['cp_new', 'cp_old'], 'most recently seen first; malformed rows dropped')
  assert.equal(people[0].stored, true)
  assert.equal(people[0].consoleLink.consoleDisplayName, 'Boss')
  assert.equal(people[0].roles[0].grantedByName, '老板')
  assert.equal(people[0].hiddenIdentities, 2)
  assert.equal(principalName(people[1]), '旧')
  assert.deepEqual(readRecentIdentities({ identities: [qq('9', { lastSeenAt: 5, principalId: 'implicit:qq:9' }), { adapter: 1 }] }), [qq('9', { lastSeenAt: 5, principalId: 'implicit:qq:9' })])
  assert.deepEqual(readIdentityMe({}), { suggestGlobalOwner: false })
  const me = readIdentityMe({ principal: person('cp_me', [qq('1')]), pendingCode: { expiresAt: 99 }, suggestGlobalOwner: true })
  assert.equal(me.principal.id, 'cp_me'); assert.equal(me.pendingCodeExpiresAt, 99); assert.equal(me.suggestGlobalOwner, true)
  assert.deepEqual(readBindCode({ code: 'ABCD2345', expiresAt: 1 }), { code: 'ABCD2345', expiresAt: 1 })
  assert.throws(() => readBindCode({ code: '' }), /Malformed/)
})

test('the grant picker offers recent speakers first, only on the scope adapter below 全局, and searches', () => {
  const recent = readRecentIdentities({ identities: [qq('100', { lastDisplayName: '小王', lastSeenAt: 3 }), { adapter: 'tg', userId: 't1', lastSeenAt: 2 }] })
  const principals = readPrincipals({ principals: [person('cp_a', [qq('100'), qq('200', { lastDisplayName: '老李' })], [], { displayName: '李' })] })
  const global = grantCandidates({ recent, principals })
  assert.deepEqual(global.map(row => `${row.adapter}/${row.userId}:${row.source}`), ['qq/100:recent', 'tg/t1:recent', 'qq/200:person'])
  assert.deepEqual(grantCandidates({ recent, principals, alias: 'qq' }).map(row => row.userId), ['100', '200'], 'below global only the scope adapter')
  assert.deepEqual(grantCandidates({ recent, principals, query: '李' }).map(row => row.userId), ['200'])
  assert.deepEqual(grantCandidates({ recent, principals, query: '小王' }).map(row => row.userId), ['100'])
  assert.deepEqual(adapterAliases([{ adapter: 'qq' }, { adapter: 'tg' }, { adapter: 'qq' }, { adapter: 'Bad Alias' }]), ['qq', 'tg'])
})

test('actions follow iam.manage; a person with a global role needs a global binding; implicit people are read-only', () => {
  const [globalHolder, plain, implicit] = readPrincipals({ principals: [
    person('cp_g', [qq('1', { lastSeenAt: 3 }), qq('2')], [{ level: 'global', key: '', role: 'owner' }]),
    person('cp_p', [qq('3', { lastSeenAt: 2 })]),
    person('implicit:qq:4', [qq('4', { lastSeenAt: 1 })]),
  ] })
  assert.deepEqual(principalActions(globalHolder, { manage: true, globalManage: false }), { rename: false, merge: false, split: false, needsGlobal: true })
  assert.deepEqual(principalActions(globalHolder, { manage: true, globalManage: true }), { rename: true, merge: true, split: true, needsGlobal: false })
  assert.deepEqual(principalActions(plain, { manage: true, globalManage: false }), { rename: true, merge: true, split: false, needsGlobal: false })
  assert.equal(principalActions(implicit, { manage: true, globalManage: true }).merge, false)
  assert.equal(principalActions(plain, { manage: false, globalManage: false }).rename, false)
  assert.deepEqual(filterPrincipals([globalHolder, plain], 'qq:3').map(item => item.id), ['cp_p'])
})

test('requests use the ADR 0060 RPC names; 设为全局 owner is a global chat-roles.grant of owner', () => {
  assert.deepEqual(principalsListRequest(), { type: CHAT_IDENTITY_RPC.PRINCIPALS_LIST })
  assert.deepEqual(principalsListRequest({ adapter: 'qq' }), { type: 'chat-principals.list', level: 'adapter', key: 'qq' })
  assert.deepEqual(recentIdentitiesRequest({ adapter: 'qq', endpoint: 'bot' }, 20), { type: 'chat-identities.recent', level: 'endpoint', key: 'qq/bot', limit: 20 })
  assert.deepEqual(recentIdentitiesRequest({}), { type: 'chat-identities.recent', level: 'global', limit: 50 })
  const me = readPrincipals({ principals: [person('cp_me', [qq('1'), { adapter: 'tg', userId: 't' }])] })[0]
  assert.deepEqual(promoteGlobalOwnerRequest(me), { type: 'chat-roles.grant', level: 'global', adapter: 'qq', userId: '1', role: 'owner' })
  assert.throws(() => promoteGlobalOwnerRequest(undefined), /no identity/)
})

test('bind code copy, countdown and grantor names (Q12)', () => {
  assert.equal(bindInstruction('ABCD2345'), '绑定 ABCD2345')
  assert.equal(bindInstruction('ABCD2345', 'en'), 'bind ABCD2345')
  assert.equal(bindCountdown(10_000 + 125_000, 10_000), '2:05')
  assert.equal(bindCountdown(0, 10_000), '0:00')
  assert.equal(grantorLabel({ grantedBy: 'console:user:u1', grantedByName: '老板' }), '老板')
  assert.equal(grantorLabel({ grantedBy: 'console:user:u2' }), 'console:user:u2')
  // chat-roles.list keeps grantedByName for the 授予记录.
  assert.equal(readChatRoles({ roles: [{ level: 'global', key: '', adapter: 'qq', userId: '1', role: 'owner', source: 'grant', grantedBy: 'console:user:u1', grantedByName: '老板' }] })[0].grantedByName, '老板')
  for (const label of Object.values(LINK_METHOD_LABELS)) assert.ok(Object.hasOwn(englishMessages, label), label)
})

test('an older Host without these RPCs is told apart from a refusal (entries hidden, not an error)', () => {
  assert.equal(isMissingIdentityRpc({ code: 'unmapped', message: 'RPC "chat-identities.me" 未登记权限' }), true)
  assert.equal(isMissingIdentityRpc(new Error('未知请求')), true)
  assert.equal(isMissingIdentityRpc(new Error('Unknown RPC type: chat-principals.list')), true)
  assert.equal(isMissingIdentityRpc(new Error('没有 iam.manage 权限')), false)
  assert.equal(isMissingIdentityRpc(new Error('Failed to fetch')), false)
})
