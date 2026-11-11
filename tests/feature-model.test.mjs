import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cellState, classifyFeatureRpcError, endpointsOfAdapter, featureProbeStatus, globalFeatureRows, mergeFeatureMatrix, readFeatureMatrix, summarizeAdapters,
} from '../console-ui/src/pages/features/feature-model.mjs'

test('an unknown feature.* RPC is told apart from a denial and from an ordinary failure', () => {
  assert.equal(classifyFeatureRpcError(new Error('Unknown RPC type: feature.matrix')), 'unsupported')
  assert.equal(classifyFeatureRpcError(new Error('HTTP 403')), 'forbidden')
  assert.equal(classifyFeatureRpcError(new Error('Token scope does not allow this route')), 'forbidden')
  assert.equal(classifyFeatureRpcError(new Error('REST request failed')), 'error')
  assert.equal(classifyFeatureRpcError('Unknown RPC type: feature.get'), 'unsupported')
})

test('the capability probe counts any non-"unknown RPC" answer as support', () => {
  assert.equal(featureProbeStatus({ ok: true }), 'available')
  assert.equal(featureProbeStatus({ ok: false, error: new Error('plugin is required') }), 'available')
  assert.equal(featureProbeStatus({ ok: false, error: new Error('Unknown RPC type: feature.get') }), 'unsupported')
  assert.equal(featureProbeStatus({ ok: false, error: new Error('HTTP 403') }), 'forbidden')
})

const plugins = [
  { name: 'welcome', instanceKey: 'welcome-main', status: 'active', description: '入群欢迎', features: [], config: { hasSchema: true }, management: { status: 'enabled', disabled: false } },
  { name: 'echo', status: 'inactive', description: '', features: [] },
  { name: 'reminder', instanceKey: 'reminder', status: 'active', features: [], management: { status: 'enabled', disabled: true } },
]

test('the global column comes from existing plugin enable state', () => {
  assert.deepEqual(globalFeatureRows(plugins), [
    { plugin: 'echo', name: 'echo', description: '', hasSchema: false, global: { enabled: false, overridden: false } },
    { plugin: 'reminder', name: 'reminder', description: '', hasSchema: false, global: { enabled: false, overridden: false } },
    { plugin: 'welcome-main', name: 'welcome', description: '入群欢迎', hasSchema: true, global: { enabled: true, overridden: false } },
  ])
})

test('without feature.matrix only the global column exists (no invented adapter cells)', () => {
  const merged = mergeFeatureMatrix(globalFeatureRows(plugins), null)
  assert.deepEqual(merged.adapters, [])
  assert.ok(merged.rows.every(row => Object.keys(row.adapters).length === 0))
})

test('a feature.matrix payload adds adapter columns; malformed payloads are rejected', () => {
  const matrix = readFeatureMatrix({
    adapters: ['qq', 'icqq'],
    rows: [{ plugin: 'welcome-main', global: { enabled: true, overridden: false }, adapters: {
      qq: { enabled: false, overridden: true }, icqq: { enabled: false, lockedBy: 'global', overridden: false }, ghost: { enabled: true },
    } }],
  })
  assert.deepEqual(matrix.adapters, ['qq', 'icqq'])
  assert.deepEqual(Object.keys(matrix.rows[0].adapters), ['qq', 'icqq'])
  const merged = mergeFeatureMatrix(globalFeatureRows(plugins), matrix)
  const welcome = merged.rows.find(row => row.plugin === 'welcome-main')
  assert.equal(cellState(welcome.adapters.qq), 'disabled')
  assert.equal(welcome.adapters.qq.overridden, true)
  assert.equal(cellState(welcome.adapters.icqq), 'locked')
  assert.equal(cellState(merged.rows.find(row => row.plugin === 'echo').adapters.qq), 'unknown')
  for (const bad of [null, {}, { adapters: [], rows: [{}] }, { adapters: ['qq'], rows: [{ plugin: 'x', global: {} }] }]) {
    assert.throws(() => readFeatureMatrix(bad), /feature\.matrix/)
  }
})

test('adapter summaries count accounts and online endpoints per instance', () => {
  const endpoints = [
    { name: 'a', adapter: 'icqq', connected: true, status: 'online', pendingRequestCount: 2 },
    { name: 'b', adapter: 'icqq', connected: false, status: 'offline' },
    { name: 'c', adapter: 'qq', connected: true, status: 'online', pendingNoticeCount: 1 },
    { name: 'd', endpoint: { adapter: 'telegram', id: 'd' }, adapter: 'ignored', connected: false, status: 'offline' },
    { name: 'broken' },
  ]
  assert.deepEqual(summarizeAdapters(endpoints), [
    { adapter: 'icqq', accounts: 2, online: 1, pending: 2 },
    { adapter: 'qq', accounts: 1, online: 1, pending: 1 },
    { adapter: 'telegram', accounts: 1, online: 0, pending: 0 },
  ])
  assert.deepEqual(endpointsOfAdapter(endpoints, 'icqq').map(item => item.name), ['a', 'b'])
})
