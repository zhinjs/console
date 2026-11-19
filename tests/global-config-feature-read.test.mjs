import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONSOLE_RPC_PERMISSIONS, FEATURE_RPC_PERMISSIONS } from '@zhin.js/console-protocol'
import {
  CONFIG_SOURCE_READ_PERMISSION, CONFIG_SOURCE_RPC, CONFIG_SOURCE_WRITE_PERMISSION, GLOBAL_FEATURE_READ_PERMISSION, globalConfigDeniedMessage,
  globalConfigReadOnlyNote, globalConfigUnsupportedMessage, globalConfigView, globalFeatureReadRequest,
} from '../console-ui/src/pages/features/global-config-model.mjs'
import { createConsoleAccess, UNRESTRICTED_ACCESS } from '../console-ui/src/utils/console-access.mjs'
import { isReadDenied } from '../console-ui/src/utils/read-error.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const access = permissions => createConsoleAccess({ permissions, bindings: [] })
const en = (message, values) => translate('en', message, values)
const zh = (message, values) => translate('zh-CN', message, values)

test('permissions come from the protocol maps, not hard-coded names', () => {
  assert.equal(CONFIG_SOURCE_RPC, 'config:get-source')
  assert.equal(CONFIG_SOURCE_READ_PERMISSION, CONSOLE_RPC_PERMISSIONS['config:get-source'])
  assert.equal(CONFIG_SOURCE_WRITE_PERMISSION, CONSOLE_RPC_PERMISSIONS['config:replace-source'])
  assert.equal(GLOBAL_FEATURE_READ_PERMISSION, FEATURE_RPC_PERMISSIONS['feature.get'])
  // The copy names the permissions the protocol currently assigns.
  assert.match(globalConfigReadOnlyNote(zh), new RegExp(CONFIG_SOURCE_WRITE_PERMISSION.replace(/\./g, '\\.')))
  assert.ok(globalConfigDeniedMessage(zh).includes(GLOBAL_FEATURE_READ_PERMISSION) && globalConfigDeniedMessage(zh).includes(CONFIG_SOURCE_READ_PERMISSION))
})

test('the source editor stays for ops.config.read; feature.view alone gets the read-only view', () => {
  assert.equal(globalConfigView(UNRESTRICTED_ACCESS), 'source')
  assert.equal(globalConfigView(access([CONFIG_SOURCE_READ_PERMISSION, CONFIG_SOURCE_WRITE_PERMISSION, GLOBAL_FEATURE_READ_PERMISSION])), 'source')
  assert.equal(globalConfigView(access([CONFIG_SOURCE_READ_PERMISSION])), 'source')
  assert.equal(globalConfigView(access(['ops.*'])), 'source')
  // Built-in operator and viewer: feature.view / feature.configure without ops.config.read.
  assert.equal(globalConfigView(access(['status.view', 'feature.view', 'feature.configure', 'feature.toggle'])), 'feature')
  assert.equal(globalConfigView(access([GLOBAL_FEATURE_READ_PERMISSION])), 'feature')
  assert.equal(globalConfigView(access(['status.view'])), 'denied')
  assert.equal(globalConfigView(access([])), 'denied')
})

test('a refused source read falls back to the read-only view when feature.view allows it', () => {
  const both = access([CONFIG_SOURCE_READ_PERMISSION, GLOBAL_FEATURE_READ_PERMISSION])
  assert.equal(globalConfigView(both, { sourceDenied: true }), 'feature')
  assert.equal(globalConfigView(access([CONFIG_SOURCE_READ_PERMISSION]), { sourceDenied: true }), 'denied')
  assert.equal(isReadDenied('HTTP 403 Forbidden'), true)
  assert.equal(isReadDenied('没有 ops.config.read 权限，无权读取'), true)
  assert.equal(isReadDenied('HTTP 500'), false)
})

test('the read-only view reads feature.get at level global', () => {
  assert.deepEqual(globalFeatureReadRequest('welcome'), { type: 'feature.get', plugin: 'welcome', level: 'global' })
  assert.ok(Object.hasOwn(FEATURE_RPC_PERMISSIONS, globalFeatureReadRequest('welcome').type))
  assert.match(read('pages/features/use-feature-data.ts'), /useGlobalFeatureDetail[\s\S]*?globalFeatureReadRequest\(plugin\)/)
  assert.match(read('pages/features/global-config-readonly.tsx'), /useGlobalFeatureDetail\(plugin\)/)
  // The page decides from the identity before any read, and only the source branch calls useConfigSource.
  const page = read('pages/features/global-config.tsx')
  assert.match(page, /const view = globalConfigView\(access\)\s*\n\s*if \(view === 'source'\) return <GlobalFeatureConfig/)
  assert.doesNotMatch(page.slice(page.indexOf('function GlobalConfigByAccess'), page.indexOf('function GlobalConfigFrame')), /useConfigSource/)
})

test('the new copy has English text', () => {
  for (const text of [globalConfigReadOnlyNote(zh), globalConfigDeniedMessage(zh), globalConfigUnsupportedMessage(zh)]) {
    const english = en(text)
    assert.notEqual(english, text, text)
    assert.doesNotMatch(english, /[㐀-鿿]/, text)
  }
  assert.match(globalConfigReadOnlyNote(en), /ops\.config\.write/)
})
