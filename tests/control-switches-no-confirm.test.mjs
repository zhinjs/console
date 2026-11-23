import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { controlSwitchConfirm } from '../console-ui/src/pages/dashboard-control-model.mjs'

// #64 `control-switches-no-confirm`: 「紧急停机」「全局静默」「只读观察」「仅提及响应」 took effect on one
// click, with nothing saying what they do, while the 「重启」 button on the same page asks first.
const KEYS = ['emergency_stop', 'muted', 'read_only', 'mention_only']

test('turning a switch on asks first and says what it does to every chat', () => {
  const texts = new Set()
  for (const key of KEYS) {
    const ask = controlSwitchConfirm(key, true)
    assert.ok(ask, key)
    assert.ok(ask.title && ask.description && ask.confirmLabel, key)
    texts.add(ask.description)
    // Only the home page shows these switches: say so, so nobody forgets to turn it off again.
    assert.match(ask.description, /只有首页/, key)
    const english = controlSwitchConfirm(key, true, 'en')
    assert.doesNotMatch(`${english.title} ${english.description} ${english.confirmLabel}`, /[一-鿿]/u, `${key} is translated`)
  }
  assert.equal(texts.size, KEYS.length, 'each switch explains its own effect')
  assert.equal(controlSwitchConfirm('emergency_stop', true).variant, 'destructive')
  assert.match(controlSwitchConfirm('mention_only', true).description, /@/)
})

test('turning a switch off restores normal replies and needs no confirmation', () => {
  for (const key of KEYS) assert.equal(controlSwitchConfirm(key, false), null, key)
  assert.equal(controlSwitchConfirm('unknown', true), null)
})

test('the home page switches go through the confirmation', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('const handleToggleControl'), source.indexOf('const controlSwitches'))
  assert.match(handler, /const ask = controlSwitchConfirm\(key, !currentValue, i18n\.locale\)/)
  assert.match(handler, /if \(ask && !\(await confirm\(ask\)\)\) return/)
  // The confirmation comes before anything is sent.
  assert.ok(handler.indexOf('await confirm(ask)') < handler.indexOf("pluginRpc<ControlState>('root', 'control-set'"))
})
