import test from 'node:test'
import assert from 'node:assert/strict'
import {
  featureChangeApplied, featureFieldView, featureLevelRow, featureLockHref, featureReceiptOutcome, featureRowCounts, featureStateSource, featureValueText,
  filterFeatureRows, globalFeatureCounts, globalFeatureOverview, parentFeatureTarget, switchOverridden,
} from '../console-ui/src/pages/features/feature-scope-model.mjs'
import { featureFieldRows } from '../console-ui/src/pages/features/feature-model.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'

const welcome = { plugin: 'welcome', displayName: '群欢迎', levels: ['global', 'adapter', 'endpoint', 'conversation'], hasSchema: true, globalEnabled: true, adapter: false, conversationFields: ['text'] }
const detail = (over = {}) => ({
  revision: 'r1', plugin: 'welcome', level: 'endpoint', key: 'qq/bot', levels: welcome.levels,
  schema: { type: 'object', properties: { text: { type: 'string' }, mention: { type: 'boolean' } } },
  values: {}, effective: { text: '你好', mention: true }, sources: { '/text': 'adapter', '/mention': 'global' }, enabled: true, ...over,
})

test('the level above an override level is the target of 继承值', () => {
  assert.deepEqual(parentFeatureTarget('adapter', 'qq'), { level: 'global' })
  assert.deepEqual(parentFeatureTarget('endpoint', 'qq/bot'), { level: 'adapter', key: 'qq' })
  assert.deepEqual(parentFeatureTarget('conversation', 'qq/bot/group:a%2Fb'), { level: 'endpoint', key: 'qq/bot' })
  assert.equal(parentFeatureTarget('conversation', 'not a key'), null)
  assert.equal(parentFeatureTarget('global'), null)
})

test('a row reports effective state, the deciding level, overrides here and the locking level', () => {
  const inherited = featureLevelRow(welcome, detail(), 'endpoint')
  assert.equal(inherited.state, 'enabled')
  assert.equal(inherited.stateSource, 'global')
  assert.equal(inherited.overriddenHere, false)
  assert.equal(inherited.configurable, true)

  const overridden = featureLevelRow(welcome, detail({ values: { text: '本层' }, effective: { text: '本层', mention: true }, sources: { '/text': 'endpoint' } }), 'endpoint')
  assert.equal(overridden.fieldOverrides, 1)
  assert.equal(overridden.overriddenHere, true)

  // Off here while nothing above disables it: this level stores the switch. `enabled` is not a field.
  const off = featureLevelRow(welcome, detail({ enabled: false, values: { enabled: false } }), 'endpoint')
  assert.equal(off.state, 'disabled')
  assert.equal(off.stateSource, 'endpoint')
  assert.equal(off.switchOverridden, true)
  assert.equal(off.fieldOverrides, 0)
  assert.ok(!off.fields.some(field => field.name === 'enabled'))

  const locked = featureLevelRow(welcome, detail({ level: 'conversation', key: 'qq/bot/group:1', enabled: false, lockedBy: 'adapter' }), 'conversation')
  assert.equal(locked.state, 'locked')
  assert.equal(locked.lockedBy, 'adapter')
  assert.equal(locked.stateSource, 'adapter')
  assert.equal(locked.switchOverridden, false)

  assert.equal(featureLevelRow(welcome, null, 'endpoint').state, 'unknown')
  assert.equal(featureStateSource(detail({ sources: { '/enabled': 'adapter' } })), 'adapter')
  assert.equal(switchOverridden(detail({ level: 'global', enabled: false })), false)
})

test('the conversation level only edits declared conversation fields', () => {
  const row = featureLevelRow(welcome, detail({ level: 'conversation', key: 'qq/bot/group:1', schema: { type: 'object', properties: { text: { type: 'string' } } } }), 'conversation')
  assert.deepEqual(row.fields.map(field => [field.name, field.editable]), [['text', true], ['mention', false]])
})

test('filters and counts', () => {
  const rows = [
    featureLevelRow(welcome, detail(), 'endpoint'),
    featureLevelRow({ ...welcome, plugin: 'rss', displayName: '订阅' }, detail({ plugin: 'rss', enabled: false, lockedBy: 'global' }), 'endpoint'),
    featureLevelRow({ ...welcome, plugin: 'repeater', displayName: '复读机' }, detail({ plugin: 'repeater', enabled: false }), 'endpoint'),
  ]
  assert.deepEqual(featureRowCounts(rows), { all: 3, overridden: 1, disabled: 1, locked: 1 })
  assert.deepEqual(filterFeatureRows(rows, 'locked').map(row => row.plugin), ['rss'])
  assert.deepEqual(filterFeatureRows(rows, 'all', '复读').map(row => row.plugin), ['repeater'])
  assert.deepEqual(filterFeatureRows(rows, 'overridden', 'REPEATER').map(row => row.plugin), ['repeater'])
})

test('lock links open the locking level’s 功能 tab', () => {
  const scope = { level: 'conversation', adapter: 'qq', endpoint: 'bot/1', kind: 'group', id: '1' }
  assert.equal(featureLockHref('global', scope), '/scope?tab=features')
  assert.equal(featureLockHref('adapter', scope), '/scope/qq?tab=features')
  assert.equal(featureLockHref('endpoint', scope), '/scope/qq/bot%2F1?tab=features')
})

test('field view separates inherited, override, effective and source; secrets stay masked', () => {
  const value = detail({ values: { text: '本层' }, effective: { text: '本层', mention: true }, sources: { '/text': 'endpoint', '/mention': 'global' } })
  const [text, mention] = featureFieldRows(value)
  assert.deepEqual(featureFieldView(text, null).inherited, { known: false, value: undefined, source: null })
  const parent = detail({ level: 'adapter', key: 'qq', effective: { text: '上级' }, sources: { '/text': 'adapter' } })
  const view = featureFieldView(text, parent)
  assert.deepEqual(view.inherited, { known: true, value: '上级', source: 'adapter' })
  assert.deepEqual(view.here, { value: '本层' })
  assert.equal(view.effective, '本层')
  assert.equal(view.source, 'endpoint')
  assert.deepEqual(featureFieldView(mention, null).inherited, { known: true, value: true, source: 'global' })
  const copy = { unset: 'unset', masked: 'masked' }
  assert.equal(featureValueText(undefined, copy), 'unset')
  assert.equal(featureValueText({ token: '[redacted]' }, copy), 'masked')
  assert.equal(featureValueText([1, 2], copy), '[1,2]')
  assert.equal(featureFieldView({ ...mention, effective: '[redacted]' }, null).masked, true)
})

test('write results map onto the receipt: conflict / invalid not applied, locked becomes a StatusState lock', () => {
  assert.deepEqual(featureReceiptOutcome({ status: 'saved', warnings: [] }), { status: 'saved' })
  assert.deepEqual(featureReceiptOutcome({ status: 'unchanged', warnings: [{ message: 'w' }] }), { status: 'unchanged', message: 'w' })
  assert.deepEqual(featureReceiptOutcome({ status: 'conflict', message: '' }), { status: 'conflict', message: 'conflict' })
  assert.equal(featureReceiptOutcome({ status: 'invalid', message: 'bad', errors: [{ path: '/text', message: 'too long' }] }).message, 'bad\n/text: too long')
  const locked = featureReceiptOutcome({ status: 'locked', lockedBy: 'adapter', message: 'locked' })
  assert.equal(locked.locked, true)
  // The panel throws { code: 'locked', lockedBy }: StatusState reads it as 已锁定 at that level.
  const reading = statusFromError(Object.assign(new Error(locked.message), { code: 'locked', lockedBy: locked.lockedBy }))
  assert.equal(reading.kind, 'locked')
  assert.equal(reading.lockedBy, 'adapter')
})

test('an unknown outcome is checked against a re-read, never resent', () => {
  assert.equal(featureChangeApplied(detail({ enabled: false }), { kind: 'enabled', enabled: false }), true)
  assert.equal(featureChangeApplied(detail({ enabled: false, lockedBy: 'global' }), { kind: 'enabled', enabled: false }), false)
  assert.equal(featureChangeApplied(detail({ values: { text: { a: 1 } } }), { kind: 'set', field: 'text', value: { a: 1 } }), true)
  assert.equal(featureChangeApplied(detail({ values: {} }), { kind: 'set', field: 'text', value: 'x' }), false)
  assert.equal(featureChangeApplied(detail({ values: {} }), { kind: 'remove', field: 'text' }), true)
  assert.equal(featureChangeApplied(detail({ values: { text: 'x' } }), { kind: 'clear' }), false)
  assert.equal(featureChangeApplied(detail({ values: {} }), { kind: 'clear' }), true)
})

test('the global overview lists where lower levels change a feature', () => {
  const rows = globalFeatureOverview([
    { plugin: 'welcome', name: 'welcome', description: '', hasSchema: true, global: { enabled: true, overridden: false },
      adapters: { qq: { enabled: true, overridden: true }, tg: { enabled: false, overridden: true }, kook: { enabled: false, overridden: false, lockedBy: 'global' } },
      conversationOverrides: { qq: { b: 2, a: 1, c: 0 } } },
    { plugin: 'parent/child', name: 'parent/child', description: '', hasSchema: false, global: { enabled: false, overridden: false }, adapters: {} },
  ], ['qq', 'tg', 'kook'], [welcome])
  assert.equal(rows[0].name, '群欢迎')
  assert.deepEqual(rows[0].below, [{ adapter: 'qq', state: 'overridden' }, { adapter: 'tg', state: 'disabled' }])
  assert.deepEqual(rows[0].conversations, [{ adapter: 'qq', endpoint: 'a', count: 1 }, { adapter: 'qq', endpoint: 'b', count: 2 }])
  assert.deepEqual(rows[0].levels, welcome.levels)
  assert.equal(rows[1].nested, true)
  assert.equal(rows[1].levels, null)
  assert.deepEqual(globalFeatureCounts(rows), { total: 2, enabled: 1, disabled: 1, customized: 1 })
})
