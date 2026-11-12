import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FEATURE_ADMIN_RPC, adminMutationRequest, adminRemovable, adminScopeAdapter, adminScopeChain, adminsApplyingTo, adminsListRequest, readAdminPage,
} from '../console-ui/src/pages/features/feature-admins-model.mjs'
import { classifyFeatureRpcError } from '../console-ui/src/pages/features/feature-model.mjs'

const CONVERSATION = 'qq/10001/group:9'

test('each level lists admins of itself and every level above it', () => {
  assert.deepEqual(adminScopeChain('global'), [{ level: 'global' }])
  assert.deepEqual(adminScopeChain('adapter', 'qq'), [{ level: 'global' }, { level: 'adapter', key: 'qq' }])
  assert.deepEqual(adminScopeChain('endpoint', 'qq/10001'), [{ level: 'global' }, { level: 'adapter', key: 'qq' }, { level: 'endpoint', key: 'qq/10001' }])
  assert.deepEqual(adminScopeChain('conversation', CONVERSATION).map(scope => scope.key ?? ''), ['', 'qq', 'qq/10001', CONVERSATION])
  assert.equal(adminScopeAdapter('conversation', CONVERSATION), 'qq')
  assert.equal(adminScopeAdapter('global'), undefined)
  for (const [level, key] of [['adapter', 'QQ'], ['adapter', 'a/b'], ['endpoint', 'qq'], ['endpoint', 'qq/a/b'], ['endpoint', 'qq/'], ['conversation', 'qq/1'], ['room', 'x']]) {
    assert.throws(() => adminScopeChain(level, key), `${level} ${key}`)
  }
})

test('feature.admins.list bodies and pages', () => {
  assert.deepEqual(adminsListRequest({ level: 'global', key: 'ignored' }), { type: FEATURE_ADMIN_RPC.LIST, level: 'global' })
  assert.throws(() => adminsListRequest({}), /level/)
  assert.deepEqual(adminsListRequest({ level: 'endpoint', key: 'qq/1', cursor: 'c' }), { type: 'feature.admins.list', level: 'endpoint', key: 'qq/1', cursor: 'c' })
  // The Host answers { admins } (sources grant / config); { items, cursor } is accepted, too.
  const host = readAdminPage({ admins: [
    { level: 'global', key: '', adapter: 'qq', userId: '1', source: 'config' },
    { level: 'adapter', key: 'qq', adapter: 'qq', userId: '2', source: 'grant', grantedBy: 'console:owner', grantedAt: 9 },
  ] })
  assert.deepEqual(host.items.map(item => [item.level, item.source]), [['global', 'config'], ['adapter', 'grant']])
  assert.equal(host.cursor, undefined)
  const page = readAdminPage({ items: [
    { level: 'endpoint', key: 'qq/1', adapter: 'qq', userId: '42', displayName: 'Ann', source: 'granted', grantedBy: 'console:owner', grantedAt: 5 },
    { level: 'global', adapter: 'qq', userId: '7', source: 'mystery' },
    { level: 'adapter', adapter: 'qq', userId: '8', source: 'grant' },
    { level: 'room', key: 'x', adapter: 'qq', userId: '9' },
    { level: 'global', adapter: '', userId: '1' },
  ], cursor: 'next' })
  assert.equal(page.cursor, 'next')
  assert.deepEqual(page.items.map(item => [item.level, item.key, item.userId, item.source]), [['endpoint', 'qq/1', '42', 'grant'], ['global', '', '7', 'config']])
  assert.equal(page.items[0].grantedBy, 'console:owner')
  for (const bad of [null, {}, { items: 3 }, { admins: 'x' }]) assert.throws(() => readAdminPage(bad), /feature\.admins\.list/)
})

const admins = [
  { level: 'global', key: '', adapter: 'tg', userId: 'root', source: 'grant' },
  { level: 'adapter', key: 'qq', adapter: 'qq', userId: '100', source: 'grant' },
  { level: 'adapter', key: 'kook', adapter: 'kook', userId: 'x', source: 'grant' },
  { level: 'endpoint', key: 'qq/10001', adapter: 'qq', userId: '1', source: 'master' },
  { level: 'endpoint', key: 'qq/20002', adapter: 'qq', userId: '2', source: 'grant' },
  { level: 'conversation', key: CONVERSATION, adapter: 'qq', userId: '55', source: 'platform', displayName: 'Owner' },
  { level: 'conversation', key: CONVERSATION, adapter: 'qq', userId: '66', source: 'grant' },
  { level: 'conversation', key: 'qq/10001/group:10', adapter: 'qq', userId: '77', source: 'grant' },
]

test('direct and inherited admins: only the same chain, top-down, duplicates collapse', () => {
  const rows = adminsApplyingTo([...admins, admins[1]], 'conversation', CONVERSATION)
  assert.deepEqual(rows.map(row => [row.level, row.userId, row.inherited]), [
    ['global', 'root', true], ['adapter', '100', true], ['endpoint', '1', true], ['conversation', '55', false], ['conversation', '66', false],
  ])
  assert.deepEqual(adminsApplyingTo(admins, 'endpoint', 'qq/10001').map(row => [row.userId, row.inherited]), [['root', true], ['100', true], ['1', false]])
  assert.deepEqual(adminsApplyingTo(admins, 'global').map(row => row.userId), ['root'])
})

test('only granted admins of this very level are removable, and only with feature.configure', () => {
  const rows = adminsApplyingTo(admins, 'conversation', CONVERSATION)
  const byUser = Object.fromEntries(rows.map(row => [row.userId, row]))
  assert.equal(adminRemovable(byUser['66'], true), true)
  assert.equal(adminRemovable(byUser['66'], false), false)
  assert.equal(adminRemovable(byUser['55'], true), false, 'group admins are implicit')
  assert.equal(adminRemovable({ ...byUser['66'], source: 'config' }, true), false, 'configuration-file admins are read-only')
  assert.equal(adminRemovable(byUser['1'], true), false, 'inherited master')
  assert.equal(adminRemovable(byUser['100'], true), false, 'inherited grant')
})

test('add / remove bodies take the adapter from the level key; global names the platform', () => {
  assert.deepEqual(adminMutationRequest('add', { level: 'conversation', key: CONVERSATION, userId: ' 66 ' }),
    { type: 'feature.admins.add', level: 'conversation', key: CONVERSATION, adapter: 'qq', userId: '66' })
  assert.deepEqual(adminMutationRequest('remove', { level: 'adapter', key: 'qq', adapter: 'qq', userId: '100' }),
    { type: 'feature.admins.remove', level: 'adapter', key: 'qq', adapter: 'qq', userId: '100' })
  assert.deepEqual(adminMutationRequest('add', { level: 'global', adapter: 'tg', userId: 'root' }),
    { type: 'feature.admins.add', level: 'global', adapter: 'tg', userId: 'root' })
  assert.throws(() => adminMutationRequest('add', { level: 'global', adapter: '', userId: 'root' }), /adapter/)
  assert.throws(() => adminMutationRequest('add', { level: 'endpoint', key: 'qq/1', adapter: 'kook', userId: '1' }), /match/)
  assert.throws(() => adminMutationRequest('add', { level: 'endpoint', key: 'qq/1', userId: '  ' }), /user id/)
  assert.throws(() => adminMutationRequest('grant', { level: 'global', adapter: 'tg', userId: '1' }), /action/)
})

test('an old Host without feature.admins.* reads as unsupported (section hidden)', () => {
  assert.equal(classifyFeatureRpcError(new Error('Unknown RPC type: feature.admins.list')), 'unsupported')
})
