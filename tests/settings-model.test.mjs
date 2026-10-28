import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSettingsCatalog, filterSettingsCatalog, resolveSettingsSelection } from '../console-ui/src/pages/settings-model.mjs'

const group = (catalog, id) => catalog.find(item => item.id === id)
const catalog = () => buildSettingsCatalog({ configVersion: 2, plugins: { qq: '@zhin.js/adapter-icqq' },
  ai: { providers: { private: { apiKey: 'SYNTHETIC-SECRET' } }, agents: { zhin: { model: 'private-model' } }, futureCapability: true },
  locale: 'en', qq: {}, legacy: { sensitive: 'HIDDEN' } },
['http', 'database', 'locale', 'log_level', 'ai', 'speech', 'plugin', 'qq'],
{ http: ['http'], database: ['database'], locale: ['locale'], log_level: ['log_level'], ai: ['ai'], speech: ['speech'], plugin: ['plugin'], qq: ['qq'] })

test('organizes authoritative Host settings and keeps one AI owner across models, presets and remaining capabilities', () => {
  const result = catalog()
  assert.deepEqual(result.map(item => item.id), ['general', 'models', 'presets', 'plugins'])
  assert.deepEqual(group(result, 'general').entries.map(item => item.configKey), ['locale', 'log_level', 'http', 'database'])
  const models = group(result, 'models').entries[0]
  const presets = group(result, 'presets').entries[0]
  const dialogue = group(result, 'plugins').entries.find(item => item.id === 'config:ai')
  const remaining = group(result, 'plugins').entries.find(item => item.id === 'ai:other')
  assert.equal(models.configKey, 'ai'); assert.deepEqual(models.fieldNames, ['providers'])
  assert.equal(presets.configKey, 'ai'); assert.deepEqual(presets.fieldNames, ['agents'])
  assert.deepEqual(dialogue.fieldNames, ['enabled', 'agent'])
  assert.ok(remaining.excludedFieldNames.includes('providers')); assert.ok(remaining.excludedFieldNames.includes('agents'))
  assert.equal(remaining.fieldNames, undefined, 'future Host fields remain visible in the remaining AI capability')
  assert.ok(group(result, 'plugins').entries.find(item => item.configKey === 'speech').builtin)
  assert.equal(group(result, 'plugins').entries.find(item => item.configKey === 'qq').section, 'extensions')
  assert.equal(group(result, 'plugins').entries.find(item => item.configKey === 'legacy').writable, false)
  assert.equal(JSON.stringify(result).includes('SYNTHETIC-SECRET'), false)
  assert.equal(JSON.stringify(result).includes('private-model'), false)
})

test('classifies every current Host AI field once and keeps future fields reachable without changing configuration', () => {
  // The current Host schema's ai.properties keys. Pinning this inventory makes
  // overlap/omission visible while the catch-all preserves forward compatibility.
  const hostFields = ['decisions', 'workroom', 'agent', 'enabled', 'providers', 'agents', 'sessions', 'context',
    'imageGeneration', 'multimodal', 'memory', 'knowledge', 'githubMcp', 'mcpServers', 'access', 'trigger', 'usage', 'audit', 'imageStorage']
  const document = { ai: Object.fromEntries([...hostFields, 'futureCapability'].map(key => [key, { unchanged: true }])) }
  const before = structuredClone(document)
  const result = buildSettingsCatalog(document, ['ai'], { ai: ['ai'] })
  const entries = result.flatMap(item => item.entries).filter(entry => entry.configKey === 'ai')
  assert.equal(entries.length, 11, 'models, presets, eight specific capabilities and one future-field fallback')
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length)
  for (const field of [...hostFields, 'futureCapability']) {
    const owners = entries.filter(entry => entry.fieldNames ? entry.fieldNames.includes(field)
      : entry.excludedFieldNames ? !entry.excludedFieldNames.includes(field) : true)
    assert.equal(owners.length, 1, `${field} belongs to exactly one presentation entry`)
    if (field === 'futureCapability') assert.equal(owners[0].id, 'ai:other')
  }
  assert.deepEqual(group(result, 'plugins').entries.map(entry => entry.title), [
    '对话与执行', '会话与上下文', '记忆与知识', '图片与感知', '外部服务', '回复与访问', '用量与审计', '协作与决策', '其他 AI 设置',
  ])
  assert.deepEqual(document, before)
})

test('only declared Host paths authorize editing; missing and aliased paths never become Host settings by name', () => {
  const input = { plugins: { ai: '@custom/ai', http: '@custom/http' }, ai: {}, http: {}, unknown: {} }
  const before = structuredClone(input)
  const result = buildSettingsCatalog(input, ['ai', 'http', 'speech', 'nested'],
    { ai: ['plugins', 'ai'], http: ['http'], nested: ['parent', 'child'] })
  assert.deepEqual(group(result, 'models').entries, [])
  assert.deepEqual(group(result, 'presets').entries, [])
  assert.deepEqual(group(result, 'general').entries, [])
  const entries = group(result, 'plugins').entries
  assert.equal(entries.find(item => item.configKey === 'ai').builtin, false)
  assert.equal(entries.find(item => item.configKey === 'http').builtin, false)
  assert.equal(entries.find(item => item.configKey === 'nested').writable, true)
  assert.equal(entries.find(item => item.configKey === 'speech').writable, false)
  assert.equal(entries.find(item => item.configKey === 'unknown').writable, false)
  assert.deepEqual(input, before, 'catalog construction never changes configuration or inserts defaults')
})

test('keeps schema-declared but unset sections reachable and tolerates empty/no-AI catalogs', () => {
  assert.deepEqual(buildSettingsCatalog({}, []).map(item => item.entries), [[], [], [], []])
  const result = buildSettingsCatalog({}, ['http', 'speech', 'plugin'], { http: ['http'], speech: ['speech'], plugin: ['plugin'] })
  assert.equal(group(result, 'general').entries[0].configKey, 'http')
  assert.equal(group(result, 'plugins').entries.find(item => item.configKey === 'speech').writable, true)
  assert.equal(group(result, 'models').entries.length, 0)
  assert.equal(group(result, 'presets').entries.length, 0)
})

test('preserves legacy plugin links, rejects removed source selections and opens scoped model/preset entries', () => {
  const result = catalog()
  assert.equal(resolveSettingsSelection('plugin:qq', result).entry.configKey, 'qq')
  assert.equal(resolveSettingsSelection('plugin:ai', result).entry.id, 'config:ai')
  assert.equal(resolveSettingsSelection('models', result).entry.id, 'ai:providers')
  assert.equal(resolveSettingsSelection('presets', result).entry.id, 'ai:agents')
  assert.deepEqual(resolveSettingsSelection('general', result), { group: 'general' })
  assert.deepEqual(resolveSettingsSelection('plugins', result), { group: 'plugins' })
  assert.deepEqual(resolveSettingsSelection('plugin:missing', result), { group: 'general' })
  assert.deepEqual(resolveSettingsSelection('yaml', result), { group: 'general' })
  assert.deepEqual(resolveSettingsSelection('declarations', result), { group: 'general' })
  const alias = buildSettingsCatalog({}, ['team/bot'], { 'team/bot': ['team', 'bot'] })
  assert.equal(resolveSettingsSelection('plugin:team/bot', alias).entry.configKey, 'team/bot')
})

test('search matches readable catalog metadata and owner keys without inspecting any saved value', () => {
  const result = catalog()
  assert.equal(filterSettingsCatalog(result, '语音').flatMap(item => item.entries).length, 1)
  assert.equal(filterSettingsCatalog(result, 'QQ').flatMap(item => item.entries)[0].configKey, 'qq')
  assert.equal(filterSettingsCatalog(result, 'SYNTHETIC-SECRET').flatMap(item => item.entries).length, 0)
  assert.equal(filterSettingsCatalog(result, 'private-model').flatMap(item => item.entries).length, 0)
  assert.equal(filterSettingsCatalog(result, '  '), result)
  assert.deepEqual(result, catalog(), 'search does not mutate the source catalog')
})
