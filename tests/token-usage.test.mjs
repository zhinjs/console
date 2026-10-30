import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MODEL_PALETTE, OTHER_COLOR, USAGE_METHOD,
  autoBucket, buildColorMap, buildUsageInput, cacheLinePoints, cacheQuantiles, cacheRatio, colorFor, collectModelKeys,
  donutSlices, formatPercent, formatTokens, hasCacheWrite, isPermissionDenied, niceMax, rangeFor, resolveBucket,
  sortSessions, splitSessionKey, stackSeries, topModelKeys, validateUsageStats,
} from '../console-ui/src/pages/token-usage-model.mjs'

const HOUR = 3600_000
const DAY = 24 * HOUR
const stats = (extra = {}) => ({
  range: { since: 0, until: DAY, bucket: 'hour', timeZone: 'Asia/Shanghai' },
  totals: { turns: 3, calls: 4, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheShare: 0.5 },
  byModel: [
    { provider: 'a', model: 'm1', calls: 3, inputTokens: 800, outputTokens: 150, cacheReadTokens: 400 },
    { provider: 'b', model: 'm2', calls: 1, inputTokens: 200, outputTokens: 50, cacheReadTokens: 100 },
  ],
  bySession: [{ sessionKey: 'icqq:8596238:group:123', turns: 2, calls: 3, inputTokens: 700, outputTokens: 100, cacheReadTokens: 350 }],
  series: [
    { bucketStart: 0, calls: 2, inputTokens: 600, outputTokens: 100, cacheReadTokens: 300, byModel: { 'a/m1': 400, 'b/m2': 200 } },
    { bucketStart: HOUR, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, byModel: {} },
  ],
  segments: { history: 600, fixed: 300, user: 100 },
  filesRead: 1, malformedLines: 0,
  ...extra,
})

test('the documented usage-stats shape is accepted; new cache fields are optional', () => {
  assert.equal(USAGE_METHOD, 'usage-stats')
  const data = stats()
  assert.equal(validateUsageStats(data), data)
  const rich = stats({ totals: { ...stats().totals, cacheWriteTokens: 10, cacheShareByCall: { p50: 0.4, p90: 0.9 } } })
  assert.doesNotThrow(() => validateUsageStats(rich))
})

test('malformed usage data throws instead of looking like zero usage', () => {
  for (const bad of [null, [], {}, stats({ range: { since: 0, until: 1, bucket: 'week' } }), stats({ byModel: {} }),
    stats({ segments: { history: 1, fixed: 'x', user: 1 } }),
    stats({ totals: { ...stats().totals, cacheShareByCall: { p50: 'x', p90: 1 } } }),
    stats({ series: [{ ...stats().series[0], byModel: { 'a/m': -1 } }] }),
    stats({ byModel: [{ ...stats().byModel[0], cacheShare: 'high' }] })]) {
    assert.throws(() => validateUsageStats(bad), /格式不正确/)
  }
  assert.throws(() => validateUsageStats(null, 'en'), /unexpected format/)
})

test('numbers use k / M / B units', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1234), '1.2k')
  assert.equal(formatTokens(15_000), '15k')
  assert.equal(formatTokens(1_500_000), '1.5M')
  assert.equal(formatTokens(2_000_000_000), '2B')
  assert.equal(formatTokens(NaN), '0')
  assert.equal(formatPercent(0.1234), '12.3%')
  assert.equal(formatPercent(7), '100%')
  assert.equal(formatPercent(-1), '0%')
})

test('cache ratio prefers the Host cacheShare and falls back to read / input', () => {
  assert.equal(cacheRatio({ inputTokens: 100, cacheReadTokens: 25 }), 0.25)
  assert.equal(cacheRatio({ inputTokens: 100, cacheReadTokens: 25, cacheShare: 0.5 }), 0.5)
  assert.equal(cacheRatio({ inputTokens: 0, cacheReadTokens: 0 }), 0)
  assert.equal(cacheRatio({ inputTokens: 10, cacheReadTokens: 50 }), 1)
  assert.equal(cacheRatio(null), 0)
})

test('cache write and per-call quantiles are shown only when present', () => {
  assert.equal(hasCacheWrite(stats()), false)
  assert.equal(hasCacheWrite(stats({ bySession: [{ ...stats().bySession[0], cacheWriteTokens: 0 }] })), false)
  assert.equal(hasCacheWrite(stats({ bySession: [{ ...stats().bySession[0], cacheWriteTokens: 5 }] })), true)
  assert.equal(cacheQuantiles(stats().totals), null)
  assert.deepEqual(cacheQuantiles({ cacheShareByCall: { p50: 0.2, p90: 0.8 } }), { p50: 0.2, p90: 0.8 })
})

test('cache line leaves gaps for buckets without input instead of drawing 0%', () => {
  const points = cacheLinePoints(stats().series)
  assert.equal(points[0].value, 0.5)
  assert.equal(points[1].value, null)
})

test('colours are stable per provider/model regardless of order and shared by every chart', () => {
  const keys = ['a/m1', 'b/m2', 'c/m3']
  const one = buildColorMap(keys)
  const two = buildColorMap([...keys].reverse())
  for (const key of keys) assert.equal(colorFor(one, key), colorFor(two, key))
  assert.equal(new Set(keys.map(key => colorFor(one, key))).size, 3)
  for (const key of keys) assert.ok(MODEL_PALETTE.includes(colorFor(one, key)))
  assert.equal(colorFor(one, 'unknown/x'), OTHER_COLOR)
  // More keys than palette entries still resolve deterministically.
  const many = Array.from({ length: 20 }, (_, i) => `p/m${i}`)
  assert.deepEqual([...buildColorMap(many)], [...buildColorMap([...many].reverse())])
  assert.deepEqual(collectModelKeys(stats()).sort(), ['a/m1', 'b/m2'])
})

test('stacked series fold unlisted models into other and keep empty buckets', () => {
  const { max, bars } = stackSeries(stats().series, ['a/m1'])
  assert.equal(bars.length, 2)
  assert.deepEqual(bars[0].parts, [{ key: 'a/m1', value: 400 }, { key: '__other__', value: 200 }])
  assert.equal(bars[0].total, 600)
  assert.equal(bars[1].total, 0)
  assert.equal(max, 600)
  const fallback = stackSeries([{ bucketStart: 0, calls: 1, inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, byModel: {} }], [])
  assert.equal(fallback.bars[0].total, 50)
  assert.deepEqual(topModelKeys(stats().byModel, 1), ['a/m1'])
  assert.equal(niceMax(600), 1000)
  assert.equal(niceMax(0), 1)
  assert.equal(niceMax(230), 250)
})

test('donut slices sum to a full turn and skip empty segments', () => {
  const slices = donutSlices([{ key: 'history', value: 3 }, { key: 'fixed', value: 0 }, { key: 'user', value: 1 }])
  assert.deepEqual(slices.map(slice => slice.key), ['history', 'user'])
  assert.equal(slices[0].share, 0.75)
  assert.ok(Math.abs(slices.at(-1).end - Math.PI * 2) < 1e-9)
  assert.deepEqual(donutSlices([{ key: 'x', value: 0 }]), [])
})

test('session keys split as platform:endpoint:scope:sceneId; short keys stay raw', () => {
  assert.deepEqual(splitSessionKey({ sessionKey: 'icqq:8596238:group:1048877509' }),
    { sessionKey: 'icqq:8596238:group:1048877509', platform: 'icqq', endpoint: '8596238', scope: 'group', sceneId: '1048877509' })
  assert.equal(splitSessionKey({ sessionKey: 'telegram:bot1:channel:a:b' }).sceneId, 'a:b')
  const schedule = splitSessionKey({ sessionKey: 'schedule:assistant-profile-weatherReport' })
  assert.deepEqual(schedule, { sessionKey: 'schedule:assistant-profile-weatherReport', platform: '', endpoint: '', scope: '', sceneId: 'schedule:assistant-profile-weatherReport' })
  assert.equal(splitSessionKey({ sessionKey: 'weird' }).sceneId, 'weird')
  assert.deepEqual(splitSessionKey({ sessionKey: 'x', platform: 'p', endpoint: 'e', scope: 's', sceneId: 'i' }), { sessionKey: 'x', platform: 'p', endpoint: 'e', scope: 's', sceneId: 'i' })
})

test('sessions sort by any column without mutating the input', () => {
  const rows = [
    { sessionKey: 'a', turns: 1, calls: 1, inputTokens: 100, outputTokens: 5, cacheReadTokens: 90 },
    { sessionKey: 'b', turns: 5, calls: 2, inputTokens: 300, outputTokens: 1, cacheReadTokens: 30 },
    { sessionKey: 'c', turns: 3, calls: 3, inputTokens: 300, outputTokens: 9, cacheReadTokens: 0 },
  ]
  const copy = structuredClone(rows)
  assert.deepEqual(sortSessions(rows).map(row => row.sessionKey), ['b', 'c', 'a'])
  assert.deepEqual(sortSessions(rows, 'turns', 'asc').map(row => row.sessionKey), ['a', 'c', 'b'])
  assert.deepEqual(sortSessions(rows, 'cache').map(row => row.sessionKey), ['a', 'b', 'c'])
  assert.deepEqual(rows, copy)
})

test('filters become RPC input; empty values are not sent', () => {
  const now = new Date(2026, 5, 15, 14, 30).getTime()
  const today = buildUsageInput({ range: 'today', bucket: 'auto' }, now).input
  assert.equal(today.since, new Date(2026, 5, 15).getTime())
  assert.equal(today.until, now)
  assert.equal(today.bucket, 'hour')
  assert.equal('session' in today, false)
  const week = buildUsageInput({ range: '7d', bucket: 'auto', session: '  icqq:group:1 ' }, now).input
  assert.equal(week.bucket, 'day')
  assert.equal(week.session, 'icqq:group:1')
  assert.equal(week.until - week.since, 7 * DAY)
  assert.equal(buildUsageInput({ range: '30d', bucket: 'auto' }, now).input.since, now - 30 * DAY)
  // Explicit hour on a long range is refused in favour of day; explicit day is honoured on a short one.
  assert.equal(buildUsageInput({ range: '30d', bucket: 'hour' }, now).input.bucket, 'day')
  assert.equal(buildUsageInput({ range: 'today', bucket: 'day' }, now).input.bucket, 'day')
  assert.equal(buildUsageInput({ range: '7d', bucket: 'hour' }, now).input.bucket, 'hour')
})

test('custom ranges must be a real, forward window', () => {
  assert.deepEqual(buildUsageInput({ range: 'custom', customSince: 1000, customUntil: 5000, bucket: 'auto' }).input, { since: 1000, until: 5000, bucket: 'hour' })
  for (const bad of [{}, { customSince: 5, customUntil: 5 }, { customSince: 9, customUntil: 1 }, { customSince: NaN, customUntil: 1 }]) {
    assert.deepEqual(buildUsageInput({ range: 'custom', ...bad }), { error: 'range' })
  }
  assert.equal(autoBucket({ since: 0, until: 3 * DAY }), 'hour')
  assert.equal(autoBucket({ since: 0, until: 3 * DAY + 1 }), 'day')
  assert.equal(resolveBucket('auto', rangeFor('30d', 100 * DAY)), 'day')
})

test('401 / 403 are permission denials', () => {
  assert.equal(isPermissionDenied({ status: 403 }), true)
  assert.equal(isPermissionDenied({ status: 401 }), true)
  assert.equal(isPermissionDenied({ status: 500 }), false)
  assert.equal(isPermissionDenied(null), false)
})

test('the page is registered under operations and reads plugin.root.usage-stats', async () => {
  const shell = await readFile(new URL('../console-ui/src/registerBuiltinShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /path: '\/agent\/usage'[\s\S]*?name: 'Token 用量'[\s\S]*?group: NAV_GROUPS\.OPERATIONS[\s\S]*?requiredPermissions: \['control:read'\]|path: '\/agent\/usage'[\s\S]*?requiredPermissions: \['control:read'\][\s\S]*?group: NAV_GROUPS\.OPERATIONS/)
  const page = await readFile(new URL('../console-ui/src/pages/token-usage.tsx', import.meta.url), 'utf8')
  assert.match(page, /pluginRpc<unknown>\('root', USAGE_METHOD/)
})
