import test from 'node:test'
import assert from 'node:assert/strict'
import * as model from '../console-ui/src/pages/attention/attention-model.mjs'

const NOW = Date.parse('2026-11-13T08:00:00.000Z')
const item = (overrides = {}) => ({
  id: 'endpoint.offline:0001', revision: 'r1', kind: 'endpoint.offline', severity: 'warning', title: 'qq / bot 离线', detail: 'Connection: closed',
  subject: { adapter: 'qq', endpointKey: 'bot' }, since: '2026-11-13T07:00:00.000Z', action: { label: '查看接入', path: '/scope/qq/bot?tab=access' }, source: 'endpoints',
  ...overrides,
})

test('Host items are read defensively: missing fields, foreign links and duplicates are dropped; unknown kinds stay', () => {
  const list = model.normalizeAttentionList({
    generatedAt: '2026-11-13T08:00:00.000Z',
    unavailable: ['plugins', 3],
    items: [
      item(),
      item(),
      item({ id: 'x', kind: 'future.kind', severity: 'info' }),
      item({ id: 'no-title', title: '' }),
      item({ id: 'bad-severity', severity: 'critical' }),
      item({ id: 'foreign', action: { label: 'x', path: 'https://evil.example/' } }),
      item({ id: 'protocol-relative', action: { label: 'x', path: '//evil.example/' } }),
      null,
    ],
  })
  assert.deepEqual(list.items.map(entry => entry.id), ['endpoint.offline:0001', 'x'])
  assert.equal(list.generatedAt, '2026-11-13T08:00:00.000Z')
  assert.deepEqual(list.unavailable, ['plugins'])
  assert.deepEqual(model.normalizeAttentionList(null), { items: [], generatedAt: null, unavailable: [] })
})

test('sorting: danger, warning, info; the oldest first within a severity; undated last', () => {
  const sorted = model.sortAttention([
    item({ id: 'i', severity: 'info', since: '2026-11-01T00:00:00.000Z' }),
    item({ id: 'w-new', severity: 'warning', since: '2026-11-13T07:00:00.000Z' }),
    item({ id: 'w-undated', severity: 'warning', since: null }),
    item({ id: 'w-old', severity: 'warning', since: '2026-11-12T07:00:00.000Z' }),
    item({ id: 'd', severity: 'danger', since: '2026-11-13T07:59:00.000Z' }),
  ])
  assert.deepEqual(sorted.map(entry => entry.id), ['d', 'w-old', 'w-new', 'w-undated', 'i'])
  assert.deepEqual(model.groupAttention(sorted).map(group => [group.severity, group.items.length]), [['danger', 1], ['warning', 3], ['info', 1]])
})

test('an older Host (Unknown RPC / unmapped) is told apart from other failures', () => {
  assert.equal(model.isAttentionUnsupported(new Error('Unknown RPC type: attention.list')), true)
  assert.equal(model.isAttentionUnsupported(new Error('RPC "attention.list" 未登记权限')), true)
  assert.equal(model.isAttentionUnsupported(Object.assign(new Error('REST request failed'), { details: { serverCode: 'unmapped' } })), true)
  assert.equal(model.isAttentionUnsupported(new Error('Failed to fetch')), false)
  assert.equal(model.isAttentionUnsupported(Object.assign(new Error('x'), { details: { serverCode: 'forbidden' } })), false)
})

test('loadAttention asks the Host in the viewer language, and falls back only for an older Host', async () => {
  const calls = []
  const host = await model.loadAttention({
    request: async request => { calls.push(request); return { items: [item()], generatedAt: '2026-11-13T08:00:00.000Z' } },
    loadFallback: async () => { throw new Error('not used') },
    locale: 'en',
  })
  assert.deepEqual(calls, [{ type: 'attention.list', data: { locale: 'en' } }])
  assert.equal(host.mode, 'host')
  assert.equal(host.items.length, 1)

  const fallback = await model.loadAttention({
    request: async () => { throw new Error('Unknown RPC type: attention.list') },
    loadFallback: async () => ({ stats: { endpoints: { total: 3, online: 1 } }, errorLogs: 0, warningLogs: 0, mcpServices: 2, connectedMcp: 2 }),
    now: () => NOW,
  })
  assert.equal(fallback.mode, 'fallback')
  assert.equal(fallback.generatedAt, new Date(NOW).toISOString())
  assert.deepEqual(fallback.items.map(entry => entry.kind), ['endpoints.offline'])

  await assert.rejects(model.loadAttention({
    request: async () => { throw new Error('Failed to fetch') },
    loadFallback: async () => { throw new Error('must not be called') },
  }), /Failed to fetch/)
})

test('the fallback derivation keeps the dashboard behaviour of older Hosts, in both languages', () => {
  assert.deepEqual(model.deriveFallbackAttention({ stats: null, hostError: 'down' }).map(entry => [entry.kind, entry.severity, entry.action.path]),
    [['host.unreachable', 'danger', '/ops/instance']])
  const none = model.deriveFallbackAttention({ stats: { endpoints: { total: 0, online: 0 } }, errorLogs: 0, warningLogs: 0 })
  assert.deepEqual(none.map(entry => entry.kind), ['endpoints.none'])
  const busy = model.deriveFallbackAttention({
    stats: { endpoints: { total: 2, online: 0 } }, errorLogs: 4, warningLogs: 2, mcpServices: 3, connectedMcp: 1,
  })
  assert.deepEqual(busy.map(entry => entry.kind), ['endpoints.offline', 'mcp.disconnected', 'logs.errors', 'logs.warnings'])
  assert.equal(busy[0].title, '2 个聊天账号离线')
  const unreadable = model.deriveFallbackAttention({ stats: { endpoints: { total: 1, online: 1 } }, errorLogs: null, logReadError: '日志库未启动' })
  assert.deepEqual(unreadable.map(entry => [entry.kind, entry.detail]), [['logs.unreadable', '日志库未启动']])
  const english = model.deriveFallbackAttention({ stats: { endpoints: { total: 2, online: 0 } }, errorLogs: 0, warningLogs: 0 }, 'en')
  assert.equal(english[0].title, '2 chat accounts offline')
  assert.equal(english[0].action.label, 'Fix it')
  // Changing counts changes the fingerprint, so an ignored fallback item comes back.
  const more = model.deriveFallbackAttention({ stats: { endpoints: { total: 3, online: 0 } }, errorLogs: 0, warningLogs: 0 })
  assert.equal(more[0].id, english[0].id)
  assert.notEqual(more[0].revision, english[0].revision)
})

test('稍后提醒 hides an item for 24 hours; 忽略 until its revision changes; 恢复 undoes both', () => {
  const a = item({ id: 'a' })
  const b = item({ id: 'b', revision: 'b1' })
  let prefs = model.emptyAttentionPrefs()
  prefs = model.snoozeAttention(prefs, a, NOW)
  prefs = model.ignoreAttention(prefs, b)
  let parts = model.partitionAttention([a, b], prefs, NOW + 1000)
  assert.deepEqual([parts.active, parts.snoozed, parts.ignored].map(list => list.map(entry => entry.id)), [[], ['a'], ['b']])
  // After 24 hours the snoozed item is back; the ignored one stays ignored while unchanged.
  parts = model.partitionAttention([a, b], prefs, NOW + model.ATTENTION_SNOOZE_MS + 1)
  assert.deepEqual(parts.active.map(entry => entry.id), ['a'])
  // A changed problem (new revision) is shown again.
  const changed = { ...b, revision: 'b2' }
  assert.deepEqual(model.partitionAttention([changed], prefs, NOW).active.map(entry => entry.id), ['b'])
  // 恢复
  prefs = model.restoreAttention(model.restoreAttention(prefs, 'a'), 'b')
  assert.deepEqual(model.partitionAttention([a, b], prefs, NOW).active.map(entry => entry.id), ['a', 'b'])
  // Ignoring clears a snooze of the same item.
  prefs = model.ignoreAttention(model.snoozeAttention(model.emptyAttentionPrefs(), a, NOW), a)
  assert.deepEqual(prefs.snoozed, {})
})

test('pruning forgets expired snoozes and outdated ignores, but keeps ignores of items absent this time', () => {
  const prefs = { snoozed: { old: NOW - 1, fresh: NOW + 1000 }, ignored: { changed: 'r1', same: 'r1', absent: 'r1' } }
  const pruned = model.pruneAttentionPrefs(prefs, [item({ id: 'changed', revision: 'r2' }), item({ id: 'same', revision: 'r1' })], NOW)
  assert.deepEqual(pruned, { snoozed: { fresh: NOW + 1000 }, ignored: { same: 'r1', absent: 'r1' } })
  assert.equal(model.samePrefs(pruned, { snoozed: { fresh: NOW + 1000 }, ignored: { same: 'r1', absent: 'r1' } }), true)
})

test('choices survive in storage per Host and user, and missing or throwing storage never breaks the list', () => {
  const key = model.attentionStorageKey('https://host.example/', 'u-1')
  assert.equal(key, 'zhin.console.attention:https://host.example:u-1')
  assert.equal(model.attentionStorageKey('', null), 'zhin.console.attention::anonymous')
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const prefs = model.snoozeAttention(model.emptyAttentionPrefs(), item(), NOW)
  assert.equal(model.writeAttentionPrefs(storage, key, prefs), true)
  assert.deepEqual(model.readAttentionPrefs(storage, key), prefs)
  const throwing = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceeded') } }
  assert.deepEqual(model.readAttentionPrefs(throwing, key), model.emptyAttentionPrefs())
  assert.equal(model.writeAttentionPrefs(throwing, key, prefs), false)
  assert.deepEqual(model.readAttentionPrefs(null, key), model.emptyAttentionPrefs())
  assert.equal(model.writeAttentionPrefs(null, key, prefs), false)
  store.set(key, '{not json')
  assert.deepEqual(model.readAttentionPrefs(storage, key), model.emptyAttentionPrefs())
  store.set(key, JSON.stringify({ snoozed: { a: 'soon', b: 5 }, ignored: { c: 3, d: 'r' } }))
  assert.deepEqual(model.readAttentionPrefs(storage, key), { snoozed: { b: 5 }, ignored: { d: 'r' } })
})

test('stored choices are bounded', () => {
  let prefs = model.emptyAttentionPrefs()
  for (let index = 0; index < model.ATTENTION_PREFS_LIMIT + 20; index += 1) prefs = model.ignoreAttention(prefs, item({ id: `i${index}` }))
  assert.equal(Object.keys(prefs.ignored).length, model.ATTENTION_PREFS_LIMIT)
  assert.equal(Object.hasOwn(prefs.ignored, `i${model.ATTENTION_PREFS_LIMIT + 19}`), true)
  assert.equal(Object.hasOwn(prefs.ignored, 'i0'), false)
})

test('the top bar badge counts danger and warning items still shown', () => {
  assert.equal(model.attentionBadgeCount([item({ severity: 'danger' }), item({ severity: 'warning' }), item({ severity: 'info' })]), 2)
  assert.equal(model.attentionBadgeCount([]), 0)
})

test('since reads as a short past time in the viewer language', () => {
  assert.equal(model.formatAttentionSince(null, NOW), null)
  assert.equal(model.formatAttentionSince(new Date(NOW - 10_000).toISOString(), NOW), '刚刚')
  assert.equal(model.formatAttentionSince(new Date(NOW - 5 * 60_000).toISOString(), NOW), '5 分钟前')
  assert.equal(model.formatAttentionSince(new Date(NOW - 3 * 3_600_000).toISOString(), NOW, 'en'), '3 h ago')
  assert.equal(model.formatAttentionSince(new Date(NOW - 3 * 86_400_000).toISOString(), NOW), '3 天前')
})

test('the debouncer coalesces a burst into one call after the quiet period', () => {
  const timers = []
  const fake = { setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1 }, clearTimeout: id => { timers[id].cleared = true } }
  let calls = 0
  const debounced = model.createDebouncer(() => { calls += 1 }, model.ATTENTION_PUSH_DEBOUNCE_MS, fake)
  debounced.trigger(); debounced.trigger(); debounced.trigger()
  assert.equal(debounced.pending, true)
  assert.deepEqual(timers.map(timer => timer.cleared), [true, true, false])
  timers[2].fn()
  assert.equal(calls, 1)
  assert.equal(debounced.pending, false)
  debounced.trigger(); debounced.cancel()
  assert.equal(timers.at(-1).cleared, true)
  assert.equal(calls, 1)
})

test('refresh cadence and limits', () => {
  assert.equal(model.ATTENTION_REFRESH_MS, 30_000)
  assert.equal(model.ATTENTION_SNOOZE_MS, 86_400_000)
  assert.equal(model.ATTENTION_PATH, '/attention')
  assert.ok(model.DASHBOARD_ATTENTION_LIMIT > 0)
})
