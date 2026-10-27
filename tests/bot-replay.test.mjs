import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REPLAY_PERMISSION,
  REPLAY_EXPORT_MAX_PAGES,
  buildReplayFilter,
  collectReplayExport,
  describeReplayRow,
  exportFileName,
  exportWindow,
  isPermissionDenied,
  validateReplayExportPage,
  validateReplayList,
  validateReplayTurn,
} from '../console-ui/src/pages/bot-replay-model.mjs'

const row = (ts, extra = {}) => ({
  id: `id-${ts}`, ts, turn_id: 't1', instance_id: '10000', platform: 'icqq', scene_id: 'group:1', user_id: null,
  kind: 'speak_gate', outcome: 'deny', reason_code: 'cannot_speak_muted', reason_detail: null, payload: {}, actor: 'policy', actor_id: null,
  ...extra,
})

test('the documented plugin.root.decisions / decision-turn shapes are accepted and declare decisions:read', () => {
  assert.equal(REPLAY_PERMISSION, 'decisions:read')
  const list = { persistent: true, items: [row(2), row(1)], nextBefore: 1 }
  assert.equal(validateReplayList(list), list)
  assert.doesNotThrow(() => validateReplayList({ persistent: false, items: [], nextBefore: null }))
  const turn = { persistent: true, turnId: 't1', startedAt: 1, endedAt: 2, truncated: false, events: [row(1), row(2)] }
  assert.equal(validateReplayTurn(turn), turn)
})

test('malformed replay data never turns into an empty page', () => {
  for (const bad of [null, [], { items: [] }, { persistent: true, items: {}, nextBefore: null }, { persistent: true, items: [{ ...row(1), ts: 'x' }], nextBefore: null },
    { persistent: true, items: [{ ...row(1), payload: '{}' }], nextBefore: null }, { persistent: true, items: [], nextBefore: 'soon' }]) {
    assert.throws(() => validateReplayList(bad), /格式不正确/)
  }
  assert.throws(() => validateReplayTurn({ turnId: 't', startedAt: 1, endedAt: 2, events: [] }), /格式不正确/)
  assert.throws(() => validateReplayExportPage({ table: 'other', window: { since: 0, until: 1 }, nextSince: null, events: [] }), /格式不正确/)
})

test('rows read as plain sentences but keep the machine code for troubleshooting', () => {
  const view = describeReplayRow(row(5, { reason_detail: 'admin' }))
  assert.equal(view.kind, '能不能在这里说话')
  assert.equal(view.outcome, '拒绝')
  assert.equal(view.reason, '机器人在这里被禁言')
  assert.equal(view.code, 'speak_gate / deny / cannot_speak_muted')
  assert.equal(view.where, 'icqq · group:1')
  assert.equal(view.detail, 'admin')
  const en = describeReplayRow(row(5), 'en')
  assert.equal(en.reason, 'The bot is muted here')
  // Unknown future codes are shown as-is, not dropped.
  assert.equal(describeReplayRow(row(5, { kind: 'future_kind', reason_code: 'future_code' })).reason, 'future_code')
})

test('filters only send known enums and non-empty text', () => {
  assert.deepEqual(buildReplayFilter({ platform: ' icqq ', sceneId: '', kind: 'model_run', outcome: 'maybe' }), { platform: 'icqq', kind: 'model_run' })
  assert.deepEqual(buildReplayFilter(null), {})
})

test('export follows nextSince until done and joins pages oldest-first', async () => {
  const window = exportWindow('1h', 10 * 3_600_000)
  assert.deepEqual(window, { since: 9 * 3_600_000, until: 10 * 3_600_000 })
  const calls = []
  const pages = [
    { table: 'ai_decision_events', exportedAt: 7, persistent: true, window, filters: { platform: 'icqq' }, count: 2, nextSince: window.since + 10, events: [row(window.since), row(window.since + 5)] },
    { table: 'ai_decision_events', exportedAt: 8, persistent: true, window, filters: { platform: 'icqq' }, count: 1, nextSince: null, events: [row(window.since + 10)] },
  ]
  const result = await collectReplayExport(async (input) => { calls.push(input); return pages[calls.length - 1] }, window, { platform: 'icqq' })
  assert.deepEqual(calls.map(c => c.since), [window.since, window.since + 10])
  assert.ok(calls.every(c => c.until === window.until && c.platform === 'icqq'))
  assert.equal(result.count, 3)
  assert.equal(result.table, 'ai_decision_events')
  assert.deepEqual(result.events.map(e => e.ts), [window.since, window.since + 5, window.since + 10])
  assert.match(exportFileName(window), /^ai_decision_events_.*\.json$/)
})

test('export stops on a cursor that does not advance or on too many pages', async () => {
  const window = { since: 100, until: 200 }
  const stuck = { table: 'ai_decision_events', exportedAt: 1, persistent: true, window, filters: {}, count: 0, nextSince: 100, events: [] }
  await assert.rejects(collectReplayExport(async () => stuck, window), /没有前进/)
  let next = 100
  await assert.rejects(collectReplayExport(async () => ({ ...stuck, nextSince: ++next }), window), /太多/)
  assert.ok(next - 100 <= REPLAY_EXPORT_MAX_PAGES)
})

test('401 / 403 are a permission notice, not an error', () => {
  assert.equal(isPermissionDenied({ status: 403 }), true)
  assert.equal(isPermissionDenied({ status: 401 }), true)
  assert.equal(isPermissionDenied({ status: 503 }), false)
})
