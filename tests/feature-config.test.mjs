import test from 'node:test'
import assert from 'node:assert/strict'
import { parse as parseYaml } from 'yaml'
import {
  cellToggleable, classifyFeatureRpcError, containsRedacted, featureFieldRows, featuresAtLevel, fieldSource, jsonSchemaToField,
  mergeFeatureMatrix, overrideDraftSeed, readFeatureDetail, readFeatureList, readFeatureMatrix, readFeatureWriteResult,
  removeOverrideRequest, setEnabledRequest, setOverrideRequest,
} from '../console-ui/src/pages/features/feature-model.mjs'
import { preserveFeatureOverrides } from '../console-ui/src/components/PluginConfigForm/feature-overrides-guard.mjs'
import { configSourceForPlugin } from '../console-ui/src/components/PluginConfigForm/source-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { sourceFilesUnder, sourceLiterals, untranslatedCjk } from './cjk-fixture.mjs'

const matrixPayload = {
  revision: 'r1',
  adapters: ['qq', 'tg-main'],
  endpoints: { qq: ['bot-1'], 'tg-main': ['news', 3] },
  rows: [
    { plugin: 'rss', displayName: 'RSS', global: { enabled: true, overridden: false }, adapters: {
      qq: { enabled: false, overridden: true }, 'tg-main': { enabled: true, overridden: false },
    } },
    { plugin: 'echo', displayName: 'Echo', global: { enabled: false, overridden: false }, adapters: {
      qq: { enabled: false, lockedBy: 'global', overridden: false }, 'tg-main': { enabled: false, lockedBy: 'global', overridden: true },
    } },
    { plugin: 'rss/child', displayName: 'Child', global: { enabled: true, overridden: false }, adapters: {} },
  ],
}

test('feature.matrix keeps revision, endpoint drill-down ids and nested instances', () => {
  const matrix = readFeatureMatrix(matrixPayload)
  assert.equal(matrix.revision, 'r1')
  assert.deepEqual(matrix.endpoints, { qq: ['bot-1'], 'tg-main': ['news'] })
  const merged = mergeFeatureMatrix([
    { plugin: 'echo', name: 'echo', description: '', hasSchema: false, global: { enabled: true, overridden: false } },
    { plugin: 'rss', name: 'rss', description: '', hasSchema: true, global: { enabled: true, overridden: false } },
  ], matrix)
  assert.equal(merged.revision, 'r1')
  assert.deepEqual(merged.rows.map(row => row.plugin), ['echo', 'rss', 'rss/child'])
  // The matrix is authoritative for the global cell (`disable_plugins`).
  assert.equal(merged.rows[0].global.enabled, false)
})

test('locked cells are never toggleable; neither is anything without feature.toggle', () => {
  const matrix = readFeatureMatrix(matrixPayload)
  const echo = matrix.rows.find(row => row.plugin === 'echo')
  const rss = matrix.rows.find(row => row.plugin === 'rss')
  assert.equal(cellToggleable(echo.adapters.qq, true), false)
  assert.equal(echo.adapters.qq.lockedBy, 'global')
  assert.equal(cellToggleable(rss.adapters.qq, true), true)
  assert.equal(cellToggleable(rss.adapters.qq, false), false)
  assert.equal(cellToggleable(undefined, true), false)
})

test('the Host feature.* denial is read as forbidden', () => {
  assert.equal(classifyFeatureRpcError(new Error('没有 feature.toggle 权限')), 'forbidden')
})

test('feature.list levels default to global; adapter / endpoint pages list only declaring features or switch-only ones', () => {
  const list = readFeatureList({ revision: 'r1', features: [
    { plugin: 'rss', displayName: 'RSS', levels: ['global', 'adapter', 'endpoint'], hasSchema: true, globalEnabled: true },
    { plugin: 'db', displayName: 'DB', levels: ['global'], hasSchema: true, globalEnabled: true },
    { plugin: 'echo', displayName: 'Echo', hasSchema: false, globalEnabled: false },
    { plugin: 'weird', displayName: 'Weird', levels: ['bogus'], hasSchema: true, globalEnabled: true },
    { plugin: 'qq', displayName: 'QQ', levels: ['global'], hasSchema: true, globalEnabled: true, adapter: true },
    { plugin: 'adapter-only', levels: ['global', 'adapter'], hasSchema: true, globalEnabled: true },
  ] })
  assert.deepEqual(list.features.find(item => item.plugin === 'echo').levels, ['global'])
  assert.deepEqual(list.features.find(item => item.plugin === 'weird').levels, ['global'])
  assert.equal(list.features.find(item => item.plugin === 'adapter-only').displayName, 'adapter-only')
  assert.deepEqual(featuresAtLevel(list.features, 'adapter').map(item => item.plugin), ['rss', 'echo', 'adapter-only'])
  assert.deepEqual(featuresAtLevel(list.features, 'endpoint').map(item => item.plugin), ['rss', 'echo'])
  assert.throws(() => readFeatureList({ features: [{}] }), /feature\.list/)
  assert.throws(() => readFeatureList(null), /feature\.list/)
})

const endpointDetail = readFeatureDetail({
  revision: 'r2', plugin: 'rss', level: 'endpoint', key: 'tg-main/news', levels: ['global', 'adapter', 'endpoint'],
  schema: { type: 'object', properties: {
    maxItems: { type: 'integer', minimum: 1, title: 'Max items' },
    format: { type: 'string', enum: ['text', 'card'] },
    filters: { type: 'object', properties: { include: { type: 'array', items: { type: 'string' } } } },
  } },
  values: { maxItems: 1 },
  effective: { maxItems: 1, format: 'card', filters: { include: ['a'] }, apiKey: '[redacted]', interval: 60 },
  sources: { '/maxItems': 'endpoint', '/format': 'adapter', '/filters/include': 'global', '/apiKey': 'global', '/interval': 'global' },
  enabled: false, lockedBy: 'adapter',
})

test('feature.get detail exposes inheritance per field and keeps the lock', () => {
  assert.equal(endpointDetail.lockedBy, 'adapter')
  assert.equal(endpointDetail.enabled, false)
  const rows = Object.fromEntries(featureFieldRows(endpointDetail).map(row => [row.name, row]))
  assert.equal(rows.maxItems.badge, 'here')
  assert.equal(rows.maxItems.overridden, true)
  assert.equal(rows.format.badge, 'adapter')
  assert.equal(rows.filters.badge, 'global')
  // Fields the level schema does not list are global-only: shown, never editable.
  assert.equal(rows.interval.editable, false)
  assert.equal(rows.apiKey.editable, false)
  assert.equal(rows.maxItems.editable, true)
  assert.throws(() => readFeatureDetail({ plugin: 'rss', level: 'nope' }), /feature\.get/)
})

test('field source picks the most specific level among nested leaves', () => {
  assert.equal(fieldSource({ '/a/x': 'global', '/a/y': 'endpoint', '/ab': 'adapter' }, 'a'), 'endpoint')
  assert.equal(fieldSource({ '/a~1b': 'adapter' }, 'a/b'), 'adapter')
  assert.equal(fieldSource({}, 'a'), null)
})

test('override drafts start from the stored or inherited value, never from a masked secret', () => {
  const rows = Object.fromEntries(featureFieldRows(endpointDetail).map(row => [row.name, row]))
  assert.equal(overrideDraftSeed(rows.maxItems), 1)
  assert.equal(overrideDraftSeed(rows.format), 'card')
  assert.equal(overrideDraftSeed(rows.apiKey), undefined)
  assert.equal(containsRedacted({ a: ['[redacted]'] }), true)
  assert.throws(() => setOverrideRequest({ plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', field: 'token', value: '[redacted]' }), /masked/)
})

test('write requests carry the read revision and only target override levels', () => {
  assert.deepEqual(setOverrideRequest({ plugin: 'rss', level: 'adapter', key: 'qq', field: 'maxItems', value: 2, revision: 'r1' }),
    { type: 'feature.set-override', plugin: 'rss', level: 'adapter', key: 'qq', patch: { maxItems: 2 }, expectedRevision: 'r1' })
  assert.deepEqual(removeOverrideRequest({ plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', field: 'maxItems', revision: 'r1' }),
    { type: 'feature.remove-override', plugin: 'rss', level: 'endpoint', key: 'qq/bot-1', paths: [['maxItems']], expectedRevision: 'r1' })
  assert.deepEqual(removeOverrideRequest({ plugin: 'rss', level: 'adapter', key: 'qq' }),
    { type: 'feature.remove-override', plugin: 'rss', level: 'adapter', key: 'qq' })
  assert.deepEqual(setEnabledRequest({ plugin: 'rss', level: 'global', key: 'ignored', enabled: false, revision: 'r1' }),
    { type: 'feature.set-enabled', plugin: 'rss', level: 'global', enabled: false, expectedRevision: 'r1' })
  assert.deepEqual(setEnabledRequest({ plugin: 'rss', level: 'adapter', key: 'qq', enabled: true }),
    { type: 'feature.set-enabled', plugin: 'rss', level: 'adapter', key: 'qq', enabled: true })
  assert.throws(() => setOverrideRequest({ plugin: 'rss', level: 'global', key: '', field: 'a', value: 1 }), /below the global level/)
  assert.throws(() => removeOverrideRequest({ plugin: 'rss', level: 'global', key: '' }), /below the global level/)
  assert.throws(() => setOverrideRequest({ plugin: 'rss', level: 'adapter', key: 'qq', field: 'a', value: undefined }), /value/)
})

test('write results: conflict / invalid / saved are told apart', () => {
  assert.equal(readFeatureWriteResult({ status: 'conflict', revision: 'r9', message: 'changed' }).status, 'conflict')
  const invalid = readFeatureWriteResult({ status: 'invalid', revision: 'r1', message: 'bad', errors: [{ path: '/maxItems', message: 'min 1' }] })
  assert.deepEqual(invalid.errors, [{ path: '/maxItems', message: 'min 1' }])
  const saved = readFeatureWriteResult({ status: 'saved', revision: 'r2', restartRequired: true, warnings: [{ code: 'unknown-endpoint', path: 'x', message: 'm' }], message: 'ok' })
  assert.equal(saved.restartRequired, true)
  assert.equal(saved.warnings.length, 1)
  assert.throws(() => readFeatureWriteResult({ status: 'done' }), /feature write/)
})

test('JSON Schema properties become Console field definitions', () => {
  assert.deepEqual(jsonSchemaToField({ type: 'integer', minimum: 1, title: 'Max' }), { type: 'number', integer: true, min: 1, title: 'Max' })
  assert.deepEqual(jsonSchemaToField({ type: 'string', enum: ['a', 'b'] }).options, [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }])
  assert.equal(jsonSchemaToField({ type: 'array', items: { type: 'string' } }).inner.type, 'string')
  const object = jsonSchemaToField({ type: 'object', properties: { on: { type: 'boolean' } } })
  assert.equal(object.type, 'object')
  assert.equal(object.object.on.type, 'boolean')
  assert.equal(jsonSchemaToField({ type: 'object', additionalProperties: { type: 'number' } }).type, 'dict')
  assert.equal(jsonSchemaToField({ type: ['string', 'null'] }).type, 'string')
  assert.equal(jsonSchemaToField({ $ref: '#/$defs/x' }).type, 'any')
  assert.equal(jsonSchemaToField({ type: 'string', writeOnly: true }).secret, true)
  assert.equal(jsonSchemaToField(null).type, 'any')
})

// ADR 0050 risk: a whole plugin block save (the global Schema form) must never drop `overrides`.
const yamlSource = [
  'plugins:',
  '  rss: {}',
  'rss:',
  '  maxItems: 5',
  '  overrides:',
  '    adapters:',
  '      qq: { enabled: false }',
  '    endpoints:',
  '      "tg-main/news": { maxItems: 1 }',
  '',
].join('\n')
const overrides = { adapters: { qq: { enabled: false } }, endpoints: { 'tg-main/news': { maxItems: 1 } } }

test('saving the global block without `overrides` keeps the stored overrides (YAML and JSON)', () => {
  const saved = parseYaml(configSourceForPlugin(yamlSource, 'yaml', ['rss'], { maxItems: 10 }))
  assert.deepEqual(saved.rss, { maxItems: 10, overrides })
  const json = JSON.stringify(parseYaml(yamlSource))
  const savedJson = JSON.parse(configSourceForPlugin(json, 'json', ['rss'], { maxItems: 7 }))
  assert.deepEqual(savedJson.rss, { maxItems: 7, overrides })
})

test('a stale or default-filled `overrides` in the draft never replaces the stored one', () => {
  const stale = parseYaml(configSourceForPlugin(yamlSource, 'yaml', ['rss'], { maxItems: 10, overrides: {} }))
  assert.deepEqual(stale.rss.overrides, overrides)
  const invented = parseYaml(configSourceForPlugin('rss:\n  maxItems: 5\n', 'yaml', ['rss'], { maxItems: 6, overrides: { adapters: {} } }))
  assert.deepEqual(invented.rss, { maxItems: 6 })
  // Removing the whole block (plugin removal) is still a removal.
  assert.equal(parseYaml(configSourceForPlugin(yamlSource, 'yaml', ['rss'], undefined)).rss, undefined)
  // Key order is kept when the draft carries the key.
  assert.deepEqual(Object.keys(preserveFeatureOverrides({ a: 1, overrides: null, b: 2 }, { overrides })), ['a', 'overrides', 'b'])
  assert.equal(preserveFeatureOverrides('scalar', { overrides }), 'scalar')
})

test('the 功能 pages show no Chinese outside the i18n helper and every literal has English copy', () => {
  const root = new URL('../console-ui/src/pages/features/', import.meta.url).pathname
  const files = sourceFilesUnder(root)
  assert.deepEqual(files.flatMap(file => untranslatedCjk(file).map(found => `${file.slice(root.length)}:${found}`)), [])
  const cjk = /[㐀-鿿]/
  const missing = [...new Set(files.flatMap(file => [...sourceLiterals(file)]))].filter(text => cjk.test(text) && !Object.hasOwn(englishMessages, text))
  assert.deepEqual(missing, [])
})
