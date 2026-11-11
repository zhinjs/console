import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendConversationPage, conversationKey, conversationOverrideCounts, conversationSegment, conversationsRequest, escapeConversationId,
  featureFieldRows, featureLockError, featureSwitchState, featuresAtLevel, filterConversations, lockFor, mergeFeatureMatrix, parseConversationKey,
  parseConversationSegment, readConversationPage, readFeatureDetail, readFeatureList, readFeatureMatrix, readFeatureWriteResult,
  removeOverrideRequest, setEnabledRequest, setOverrideRequest, unescapeConversationId,
} from '../console-ui/src/pages/features/feature-model.mjs'
import { CONSOLE_PATHS, conversationFeatureHref, endpointConversationsHref } from '../console-ui/src/console-routes.mjs'
import { ROUTE_PERMISSIONS } from '../console-ui/src/navigation-sections.mjs'

test('conversation keys follow the Host escaping: only % and / in the id are escaped', () => {
  assert.equal(conversationKey({ adapter: 'qq', endpoint: '10001', kind: 'group', id: '123456' }), 'qq/10001/group:123456')
  assert.equal(conversationKey({ adapter: 'tg-main', endpoint: 'bot', kind: 'channel', id: 'a/b%c:d' }), 'tg-main/bot/channel:a%2Fb%25c:d')
  assert.equal(escapeConversationId('50%/x'), '50%25%2Fx')
  assert.equal(unescapeConversationId('50%25%2Fx'), '50%/x')
  assert.equal(unescapeConversationId('50%2fx'), '50/x')
  assert.equal(unescapeConversationId('bad%20'), undefined)
  assert.equal(unescapeConversationId('a/b'), undefined)
  for (const bad of [
    { adapter: 'QQ', endpoint: 'e', kind: 'group', id: '1' },
    { adapter: 'qq', endpoint: 'a/b', kind: 'group', id: '1' },
    { adapter: 'qq', endpoint: 'e', kind: 'room', id: '1' },
    { adapter: 'qq', endpoint: 'e', kind: 'group', id: '' },
    { adapter: 'qq', endpoint: 'e', kind: 'group', id: 'line\nbreak' },
    { adapter: 'qq', endpoint: 'e', kind: 'group', id: 'x'.repeat(257) },
  ]) assert.throws(() => conversationKey(bad), JSON.stringify(bad))
})

test('conversation keys round-trip and only the canonical form parses', () => {
  for (const ref of [
    { adapter: 'qq', endpoint: '10001', kind: 'private', id: 'user:42' },
    { adapter: 'discord', endpoint: 'main', kind: 'channel', id: 'guild/1%2' },
  ]) assert.deepEqual(parseConversationKey(conversationKey(ref)), ref)
  for (const bad of ['qq/10001', 'qq/10001/group', 'qq/10001/room:1', 'qq/10001/group:', 'qq/10001/group:a/b', 'qq/10001/group:%41', '/e/group:1', 42]) {
    assert.equal(parseConversationKey(bad), null, String(bad))
  }
})

test('the conversation route encodes <kind>:<id> as one path segment', () => {
  assert.equal(CONSOLE_PATHS.adapterConversation, '/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation')
  assert.deepEqual(ROUTE_PERMISSIONS[CONSOLE_PATHS.adapterConversation], ['feature.view'])
  const href = conversationFeatureHref('qq', '10001', 'group', 'a/b?#c')
  assert.equal(href, '/features/adapters/qq/endpoints/10001/conversations/group%3Aa%2Fb%3F%23c')
  const segment = decodeURIComponent(href.split('/').at(-1))
  assert.deepEqual(parseConversationSegment(segment), { kind: 'group', id: 'a/b?#c' })
  assert.equal(conversationSegment('private', 'u:1'), 'private:u:1')
  assert.deepEqual(parseConversationSegment('private:u:1'), { kind: 'private', id: 'u:1' })
  for (const bad of ['group', 'group:', ':1', 'room:1', undefined]) assert.equal(parseConversationSegment(bad), null)
  assert.equal(endpointConversationsHref('qq', 'a b'), '/features/adapters/qq/endpoints/a%20b?tab=conversations')
})

test('locks resolve top-down across the four levels', () => {
  assert.equal(lockFor({}, 'conversation'), undefined)
  assert.equal(lockFor({ global: true, adapter: true, endpoint: true }, 'conversation'), undefined)
  assert.equal(lockFor({ endpoint: false }, 'conversation'), 'endpoint')
  assert.equal(lockFor({ adapter: false, endpoint: false }, 'conversation'), 'adapter')
  assert.equal(lockFor({ global: false, adapter: false }, 'conversation'), 'global')
  assert.equal(lockFor({ global: false }, 'endpoint'), 'global')
  assert.equal(lockFor({ adapter: false }, 'endpoint'), 'adapter')
  // A level's own switch never locks itself, nor anything above it.
  assert.equal(lockFor({ endpoint: false }, 'endpoint'), undefined)
  assert.equal(lockFor({ endpoint: false, conversation: false }, 'adapter'), undefined)
  assert.equal(lockFor({ global: false }, 'global'), undefined)
  assert.throws(() => lockFor({}, 'room'))
})

test('a locked switch is off and inert in both directions, even if its own level stores enabled', () => {
  assert.deepEqual(featureSwitchState({ enabled: true, lockedBy: 'endpoint' }, true), { checked: false, disabled: true, locked: true })
  assert.deepEqual(featureSwitchState({ enabled: false, lockedBy: 'global' }, true), { checked: false, disabled: true, locked: true })
  assert.deepEqual(featureSwitchState({ enabled: true }, true), { checked: true, disabled: false, locked: false })
  assert.deepEqual(featureSwitchState({ enabled: true }, false), { checked: true, disabled: true, locked: false })
  assert.equal(featureSwitchState({ enabled: false }, true, true).disabled, true)
  for (const lockedBy of ['global', 'adapter', 'endpoint']) {
    for (const enabled of [true, false]) {
      assert.throws(() => setEnabledRequest({ plugin: 'rss', level: 'conversation', key: 'qq/1/group:2', enabled, lockedBy }), new RegExp(lockedBy))
    }
  }
  assert.deepEqual(setEnabledRequest({ plugin: 'rss', level: 'conversation', key: 'qq/1/group:2', enabled: false, revision: '3' }),
    { type: 'feature.set-enabled', plugin: 'rss', level: 'conversation', key: 'qq/1/group:2', enabled: false, expectedRevision: '3' })
})

test('feature.get and feature.matrix keep endpoint locks', () => {
  const detail = readFeatureDetail({ revision: '0', plugin: 'rss', level: 'conversation', key: 'qq/1/group:2', levels: ['global', 'endpoint', 'conversation'],
    enabled: false, lockedBy: 'endpoint', sources: { '/a': 'conversation', '/b': 'endpoint', '/c': 'bogus' } })
  assert.equal(detail.level, 'conversation')
  assert.equal(detail.lockedBy, 'endpoint')
  assert.deepEqual(detail.levels, ['global', 'endpoint', 'conversation'])
  assert.deepEqual(detail.sources, { '/a': 'conversation', '/b': 'endpoint' })
  const matrix = readFeatureMatrix({ adapters: ['qq'], rows: [{ plugin: 'rss', global: { enabled: true, overridden: false }, adapters: { qq: { enabled: false, lockedBy: 'endpoint', overridden: false } } }] })
  assert.equal(matrix.rows[0].adapters.qq.lockedBy, 'endpoint')
})

test('a Host lock refusal (409 locked) is recognised, with the level when it is named', () => {
  assert.deepEqual(featureLockError(Object.assign(new Error('x'), { code: 'locked', lockedBy: 'adapter' })), { lockedBy: 'adapter' })
  assert.deepEqual(featureLockError(new Error('Feature rss is locked: lockedBy=endpoint')), { lockedBy: 'endpoint' })
  assert.deepEqual(featureLockError(new Error('rss is locked by the global level')), { lockedBy: 'global' })
  assert.deepEqual(featureLockError(new Error('插件 rss 已在账号禁用，下级不能修改开关')), { lockedBy: 'endpoint' })
  assert.deepEqual(featureLockError(new Error('locked')), {})
  assert.equal(featureLockError(new Error('HTTP 500')), null)
  assert.equal(featureLockError(new Error('Unknown RPC type: feature.set-enabled')), null)
  const result = readFeatureWriteResult({ status: 'locked', lockedBy: 'global', revision: '1' })
  assert.equal(result.status, 'locked')
  assert.equal(result.lockedBy, 'global')
})

const conversationDetail = {
  revision: '2', plugin: 'repeater', level: 'conversation', key: 'qq/1/group:9', levels: ['global', 'adapter', 'endpoint', 'conversation'],
  schema: { type: 'object', properties: { threshold: { type: 'integer' }, mode: { type: 'string' } } },
  values: { threshold: 5 },
  effective: { threshold: 5, mode: 'loose', cooldown: 30, prefix: '!' },
  sources: { '/threshold': 'conversation', '/mode': 'endpoint', '/cooldown': 'adapter', '/prefix': 'global' },
  enabled: true,
}

test('field source badges cover all four levels, incl. 继承自账号', () => {
  const rows = featureFieldRows(readFeatureDetail(conversationDetail))
  const byName = Object.fromEntries(rows.map(row => [row.name, row]))
  assert.equal(byName.threshold.badge, 'here')
  assert.equal(byName.threshold.overridden, true)
  assert.equal(byName.mode.badge, 'endpoint')
  assert.equal(byName.cooldown.badge, 'adapter')
  assert.equal(byName.prefix.badge, 'global')
  assert.equal(byName.mode.editable, true)
  assert.equal(byName.cooldown.editable, false)
  // On the endpoint level an endpoint source is "here".
  const endpointRows = featureFieldRows(readFeatureDetail({ ...conversationDetail, level: 'endpoint', key: 'qq/1', values: {}, sources: { '/mode': 'endpoint' } }))
  assert.equal(endpointRows.find(row => row.name === 'mode').badge, 'here')
})

test('conversation fields are limited to conversationFields when the plugin declares them', () => {
  const list = readFeatureList({ revision: 'r', features: [
    { plugin: 'repeater', levels: ['global', 'endpoint', 'conversation'], hasSchema: true, conversationFields: ['threshold', 'threshold', 3] },
    { plugin: 'rss', levels: ['global', 'adapter'], hasSchema: true },
    { plugin: 'echo', levels: ['global'], hasSchema: false },
  ] })
  assert.deepEqual(list.features[0].conversationFields, ['threshold'])
  assert.deepEqual(featuresAtLevel(list.features, 'conversation').map(feature => feature.plugin), ['repeater', 'echo'])
  const rows = featureFieldRows(readFeatureDetail(conversationDetail), list.features[0].conversationFields)
  assert.deepEqual(rows.filter(row => row.editable).map(row => row.name), ['threshold'])
  // Without a declared list the Host-narrowed schema decides.
  assert.deepEqual(featureFieldRows(readFeatureDetail(conversationDetail)).filter(row => row.editable).map(row => row.name), ['threshold', 'mode'])
  // A conversation-level detail can carry the list itself.
  assert.deepEqual(featureFieldRows(readFeatureDetail({ ...conversationDetail, conversationFields: [] })).filter(row => row.editable), [])
})

test('override bodies accept the conversation level', () => {
  assert.deepEqual(setOverrideRequest({ plugin: 'repeater', level: 'conversation', key: 'qq/1/group:9', field: 'threshold', value: 7, revision: '2' }),
    { type: 'feature.set-override', plugin: 'repeater', level: 'conversation', key: 'qq/1/group:9', patch: { threshold: 7 }, expectedRevision: '2' })
  assert.deepEqual(removeOverrideRequest({ plugin: 'repeater', level: 'conversation', key: 'qq/1/group:9', revision: '0' }),
    { type: 'feature.remove-override', plugin: 'repeater', level: 'conversation', key: 'qq/1/group:9', expectedRevision: '0' })
  assert.throws(() => setOverrideRequest({ plugin: 'x', level: 'global', key: '', field: 'a', value: 1 }))
})

test('feature.conversations: request, page validation, pagination and the overrides filter', () => {
  assert.deepEqual(conversationsRequest({ adapter: 'qq', endpoint: '1', query: '  team ', limit: 50, cursor: '' }),
    { type: 'feature.conversations', adapter: 'qq', endpoint: '1', query: 'team', limit: 50 })
  assert.deepEqual(conversationsRequest(), { type: 'feature.conversations' })
  const first = readConversationPage({
    conversations: [
      { key: 'qq/1/group:9', adapter: 'qq', endpointId: '1', kind: 'group', id: '9', name: 'Team', hasOverrides: true,
        overrides: [{ plugin: 'rss', enabled: false, fields: [], revision: '1', updatedAt: 5 }, { plugin: 'repeater', fields: ['threshold'], revision: '2', updatedAt: 6, updatedBy: 'qq:42' }] },
      { key: 'qq/1/private:u%2F1', adapter: 'qq', endpointId: '1', kind: 'private', id: 'u/1', hasOverrides: false, overrides: [], lastActiveAt: 7 },
      { key: 'not a key', hasOverrides: true },
      null,
    ],
    nextCursor: 'c2',
    recentAvailable: true,
  })
  assert.equal(first.cursor, 'c2')
  assert.equal(first.recentAvailable, true)
  assert.deepEqual(first.items.map(item => [item.key, item.kind, item.id, item.overrideCount]), [['qq/1/group:9', 'group', '9', 2], ['qq/1/private:u%2F1', 'private', 'u/1', 0]])
  assert.equal(first.items[0].overrides[0].disabled, true)
  assert.equal(first.items[0].overrides[1].updatedBy, 'qq:42')
  assert.equal(first.items[0].name, 'Team')
  const second = readConversationPage({ conversations: [
    { key: 'qq/1/group:9', hasOverrides: false, overrides: [] },
    { key: 'qq/1/channel:x', hasOverrides: true },
  ], recentAvailable: true })
  assert.equal(second.cursor, undefined)
  assert.equal(second.items[1].overrideCount, null)
  const merged = appendConversationPage(first, second)
  assert.deepEqual(merged.items.map(item => item.key), ['qq/1/group:9', 'qq/1/private:u%2F1', 'qq/1/channel:x'])
  assert.equal(merged.items[0].hasOverrides, false, 'the newer copy wins')
  assert.equal(merged.cursor, undefined)
  assert.deepEqual(filterConversations(merged.items, true).map(item => item.key), ['qq/1/channel:x'])
  assert.equal(filterConversations(merged.items, false).length, 3)
  for (const bad of [null, {}, { items: [] }]) assert.throws(() => readConversationPage(bad), /feature\.conversations/)
})

test('per-endpoint conversation override counts are optional on the matrix and its rows', () => {
  const matrix = readFeatureMatrix({ adapters: ['qq'], conversationOverrides: { qq: { b: 2, a: 1, z: 0, bad: -1, f: 1.5 }, x: 3 },
    rows: [{ plugin: 'rss', global: { enabled: true, overridden: false }, adapters: {}, conversationOverrides: { qq: { a: 4 } } }] })
  assert.deepEqual(conversationOverrideCounts(matrix.conversationOverrides, 'qq'), [{ endpoint: 'a', count: 1 }, { endpoint: 'b', count: 2 }])
  assert.deepEqual(conversationOverrideCounts(matrix.rows[0].conversationOverrides, 'qq'), [{ endpoint: 'a', count: 4 }])
  const merged = mergeFeatureMatrix([{ plugin: 'rss', name: 'rss', description: '', hasSchema: true, global: { enabled: true, overridden: false } }], matrix)
  assert.deepEqual(merged.conversationOverrides, { qq: { b: 2, a: 1, z: 0 } })
  assert.deepEqual(merged.rows[0].conversationOverrides, { qq: { a: 4 } })
  // Older Hosts send nothing: nothing is shown.
  const old = readFeatureMatrix({ adapters: ['qq'], rows: [] })
  assert.equal(old.conversationOverrides, undefined)
  assert.deepEqual(conversationOverrideCounts(undefined, 'qq'), [])
})
