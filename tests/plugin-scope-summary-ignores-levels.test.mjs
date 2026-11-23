import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { pluginSettableLevels } from '../console-ui/src/pages/plugin-scope-model.mjs'
import { featuresAtLevel } from '../console-ui/src/pages/features/feature-model.mjs'

// #64 `plugin-scope-summary-ignores-levels`: /plugins/weather listed adapters and 「会话覆盖：没有会话
// 单独覆盖这个插件」 as if it could be set per adapter or per conversation, while weather only declares
// 「全局」 — 28 of 42 features are like that — and nothing said why or how to switch it per group.
const list = { revision: 'r1', features: [
  { plugin: 'weather', displayName: '天气', levels: ['global'], hasSchema: true, globalEnabled: true, adapter: false },
  { plugin: 'welcome', displayName: '入群欢迎', levels: ['global', 'adapter', 'endpoint', 'conversation'], hasSchema: true, globalEnabled: true, adapter: false },
  { plugin: 'repeater', displayName: '复读', levels: ['global'], hasSchema: false, globalEnabled: true, adapter: false },
  { plugin: 'icqq', displayName: 'icqq', levels: ['global'], hasSchema: true, globalEnabled: true, adapter: true },
] }

test('a plugin declaring only 「全局」 cannot be set per account or conversation', () => {
  assert.deepEqual(pluginSettableLevels(list, 'weather'), { levels: ['global'], endpoint: false, conversation: false })
  assert.deepEqual(pluginSettableLevels(list, 'welcome'), { levels: ['global', 'adapter', 'endpoint', 'conversation'], endpoint: true, conversation: true })
  // No configuration schema: only the on/off switch, which every level has (ADR 0050 §2).
  assert.deepEqual(pluginSettableLevels(list, 'repeater'), { levels: ['global'], endpoint: true, conversation: true })
  assert.equal(pluginSettableLevels(list, 'unknown'), null)
  assert.equal(pluginSettableLevels(null, 'weather'), null)
})

test('it agrees with what the account and conversation pages actually list', () => {
  for (const level of ['endpoint', 'conversation']) {
    const listed = featuresAtLevel(list.features, level).map(feature => feature.plugin)
    for (const feature of list.features.filter(item => !item.adapter)) {
      assert.equal(pluginSettableLevels(list, feature.plugin)[level], listed.includes(feature.plugin), `${feature.plugin} @ ${level}`)
    }
  }
})

test('the plugin page reads the levels and says when a plugin is global-only', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/plugin-detail.tsx', import.meta.url), 'utf8')
  assert.match(source, /readFeatureList\(await requestConsole<unknown>\(\{ type: FEATURE_RPC\.LIST \}\)\)/)
  assert.match(source, /<ScopeSummary summary=\{scopeSummary\} levels=\{settableLevels\} \/>/)
  assert.match(source, /\{i18n\.t\("可设置层级"\)\}/)
  assert.match(source, /levels && !levels\.conversation \? \(/)
  assert.match(source, /i18n\.t\("这个插件没有声明会话层级，不能按群或会话单独开关或配置；/)
})
