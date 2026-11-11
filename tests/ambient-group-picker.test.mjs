import test from 'node:test'
import assert from 'node:assert/strict'
import { describeReadFailure, isPermissionDenied } from '../console-ui/src/pages/ambient-engagement-model.mjs'
import {
  addManualGroups,
  buildGroupCatalog,
  filterGroupCatalog,
  groupNamesFromCatalog,
  groupPickerView,
  groupsOutsideCatalog,
  readGroupEndpoints,
  toggleGroupSelection,
} from '../console-ui/src/pages/ambient-group-picker-model.mjs'

const catalog = buildGroupCatalog([
  { adapter: 'qq', endpoint: 'main-bot', groups: [{ group_id: 1001, name: '开发群' }, { group_id: 1002, group_name: '闲聊' }, { group_id: 1001, name: '重复' }, { group_id: 0, name: '无效' }] },
  { adapter: 'slack', endpoint: 'work', groups: [{ group_id: 'C0123ABC', name: 'general' }, { group_id: '1234567890123456789', name: '' }] },
  { adapter: 'qq', endpoint: 'backup-bot', error: 'endpoint not found' },
])

test('endpoint.list maps to the canonical platform the Host matches the whitelist against', () => {
  const endpoints = readGroupEndpoints({ endpoints: [
    { name: 'main-bot', adapter: 'qq', connected: true, endpoint: { id: 'e1', adapter: 'qq' } },
    { name: 'legacy', adapter: 'icqq', connected: false },
    { name: '', adapter: 'qq', connected: true },
  ] })
  assert.deepEqual(endpoints, [{ adapter: 'qq', name: 'main-bot', connected: true }, { adapter: 'icqq', name: 'legacy', connected: false }])
  assert.throws(() => readGroupEndpoints(null))
})

test('group lists are grouped by account, keep string and large ids exactly, and write platform:groupId', () => {
  assert.deepEqual(catalog.sections.map((section) => [section.key, section.groups.map((group) => group.value)]), [
    ['qq/main-bot', ['qq:1001', 'qq:1002']],
    ['slack/work', ['slack:C0123ABC', 'slack:1234567890123456789']],
  ])
  assert.deepEqual(catalog.sections[0].groups[1], { value: 'qq:1002', id: '1002', name: '闲聊' })
  assert.deepEqual(catalog.failures, [{ adapter: 'qq', endpoint: 'backup-bot', error: 'endpoint not found' }])
  assert.equal(groupNamesFromCatalog(catalog).get('qq:1001'), '开发群')
})

test('search matches group name, id, platform:id and account name', () => {
  const values = (query) => filterGroupCatalog(catalog, query).flatMap((section) => section.groups.map((group) => group.value))
  assert.deepEqual(values('开发'), ['qq:1001'])
  assert.deepEqual(values('1002'), ['qq:1002'])
  assert.deepEqual(values('SLACK:c0123'), ['slack:C0123ABC'])
  assert.deepEqual(values('work'), ['slack:C0123ABC', 'slack:1234567890123456789'])
  assert.deepEqual(values('不存在'), [])
})

test('whitelist entries missing from the group list stay visible and removable', () => {
  assert.deepEqual(groupsOutsideCatalog(['qq:1001', 'qq:999', 'telegram:-100'], catalog), ['qq:999', 'telegram:-100'])
  assert.deepEqual(toggleGroupSelection(['qq:999'], 'qq:1001'), ['qq:999', 'qq:1001'])
  assert.deepEqual(toggleGroupSelection(['qq:999', 'qq:1001'], 'qq:999'), ['qq:1001'])
})

test('manual input stays as a fallback and only adds well-formed platform:groupId entries', () => {
  assert.deepEqual(addManualGroups(['qq:1'], ' qq:2，qq:1\nwechat:abc '), { groups: ['qq:1', 'qq:2', 'wechat:abc'], invalid: [] })
  assert.deepEqual(addManualGroups(['qq:1'], 'qq:2, 123456'), { groups: ['qq:1'], invalid: ['123456'] })
})

test('only 401/403 count as a permission problem; other failures keep their real reason', () => {
  for (const denied of [{ status: 401 }, { status: 403 }, 'HTTP 403', 'Invalid or missing token', 'Token scope does not allow this route', 'Demo scope: RPC "endpoint.groups" is forbidden']) {
    assert.equal(isPermissionDenied(denied), true, JSON.stringify(denied))
  }
  for (const other of [{ status: 500 }, { status: 404, message: 'forbidden' }, 'HTTP 500', 'REST request failed', 'The operation was aborted due to timeout', '当前适配器（qq）不支持群列表', undefined, '']) {
    assert.equal(isPermissionDenied(other), false, JSON.stringify(other))
  }
  const failure = describeReadFailure('HTTP 502', '群聊插话设置')
  assert.equal(failure.denied, false)
  assert.equal(failure.text, '群聊插话设置读取失败：HTTP 502')
  assert.doesNotMatch(failure.text, /权限|管理员/)
  assert.match(describeReadFailure('Token scope does not allow this route', '群列表').text, /没有读取群列表的权限/)
  assert.equal(describeReadFailure(new Error('boom'), '群列表').detail, 'boom')
})

test('the group list area is in exactly one state, and failures never read as an empty list', () => {
  assert.equal(groupPickerView({ loading: true, error: null, catalog: null, query: '' }).kind, 'loading')
  assert.deepEqual(groupPickerView({ loading: false, error: 'HTTP 500', catalog: null, query: '' }), { kind: 'error', error: 'HTTP 500' })
  assert.equal(groupPickerView({ loading: false, error: 'HTTP 403', catalog: null, query: '' }).kind, 'denied')
  const allFailed = buildGroupCatalog([{ adapter: 'qq', endpoint: 'a', error: 'REST request failed' }, { adapter: 'qq', endpoint: 'b', groups: [] }])
  assert.equal(groupPickerView({ loading: false, error: null, catalog: allFailed, query: '' }).kind, 'error')
  const allDenied = buildGroupCatalog([{ adapter: 'qq', endpoint: 'a', error: 'HTTP 403' }])
  assert.equal(groupPickerView({ loading: false, error: null, catalog: allDenied, query: '' }).kind, 'denied')
  assert.deepEqual(groupPickerView({ loading: false, error: null, catalog: buildGroupCatalog([]), query: '' }), { kind: 'empty', noOnlineAccount: true })
  assert.deepEqual(groupPickerView({ loading: false, error: null, catalog: buildGroupCatalog([{ adapter: 'qq', endpoint: 'a', groups: [] }]), query: '' }), { kind: 'empty', noOnlineAccount: false })
  assert.equal(groupPickerView({ loading: false, error: null, catalog, query: 'zzz' }).kind, 'no-match')
  const ready = groupPickerView({ loading: false, error: null, catalog, query: '' })
  assert.equal(ready.kind, 'ready')
  assert.equal(ready.sections.length, 2)
})
