import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MIN_RATIO_SAMPLE, countReading, observationCoverage, ratioReading } from '../console-ui/src/pages/dashboard-basis-model.mjs'

const HOUR = 3600_000
const now = 100 * HOUR

test('coverage says whether the event buffer spans the window, starts later, or was cut off', () => {
  assert.equal(observationCoverage([], { now, windowMs: 24 * HOUR }).kind, 'none')
  assert.equal(observationCoverage(null, { now, windowMs: 24 * HOUR }).kind, 'none')
  assert.deepEqual(observationCoverage([{ timestamp: now - 30 * HOUR }], { now, windowMs: 24 * HOUR }), { kind: 'full', since: now - 24 * HOUR, until: now, windowStart: now - 24 * HOUR })
  assert.equal(observationCoverage([{ timestamp: now - 2 * HOUR }], { now, windowMs: 24 * HOUR }).kind, 'since-restart')
  const partial = observationCoverage([{ timestamp: now - 2 * HOUR }], { now, windowMs: 24 * HOUR, truncated: true })
  assert.equal(partial.kind, 'partial')
  assert.equal(partial.since, now - 2 * HOUR)
})

test('missing samples read as not recorded or insufficient, never as zero', () => {
  assert.deepEqual(countReading(null), { kind: 'unrecorded' })
  assert.deepEqual(countReading(undefined), { kind: 'unrecorded' })
  assert.deepEqual(countReading(0, { loaded: false }), { kind: 'unrecorded' })
  assert.deepEqual(countReading(0), { kind: 'value', value: 0 })
  assert.deepEqual(ratioReading(1, MIN_RATIO_SAMPLE - 1), { kind: 'insufficient', sample: MIN_RATIO_SAMPLE - 1 })
  assert.deepEqual(ratioReading(0, 0), { kind: 'insufficient', sample: 0 })
  assert.deepEqual(ratioReading(3, 6), { kind: 'value', value: 50 })
  assert.deepEqual(ratioReading(20, 6), { kind: 'value', value: 100 })
  assert.deepEqual(ratioReading(Number.NaN, 6), { kind: 'unrecorded' })
})

test('the dashboard labels its basis and marks time-paired replies as only possibly related', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(source, /缓冲内观察/)
  assert.match(source, /持久统计/)
  assert.match(source, /可能相关/)
  assert.match(source, /i18n\.t\("未记录"\)/)
  assert.doesNotMatch(source, /synth-1|synth-2/, 'no made-up log lines when the Host has none')
  assert.doesNotMatch(source, /i18n\.t\("已回复"\)/, 'a message sent after another is not proof of a reply')
  assert.match(source, /conversationHref\(item\.adapter, item\.endpoint, item\.kind as ConversationKind, item\.channelId, 'records'\)/)
})

test('the bot status page leaves process state to the instance page and does not flag IM-only setups', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/agent-workbench.tsx', import.meta.url), 'utf8')
  assert.match(source, /CONSOLE_PATHS\.opsInstance/)
  assert.match(source, /const imOnly = !error && agentStatus === 'unavailable'/)
  assert.doesNotMatch(source, /i18n\.t\("在线渠道"\)/)
  assert.doesNotMatch(source, /variant="destructive"/)
})
