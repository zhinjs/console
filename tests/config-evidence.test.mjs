import test from 'node:test'
import assert from 'node:assert/strict'
import { configurationSaveSummary } from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'

test('save copy follows the real Host restart evidence and never claims an unconfirmed application', () => {
  assert.match(configurationSaveSummary({ success: true, revision: 'r1', restartRequired: true }), /需要重启/)
  assert.doesNotMatch(configurationSaveSummary({ success: true, revision: 'r1', restartRequired: false }), /需要重启/)
  assert.match(configurationSaveSummary({ success: true, revision: 'r1' }), /未提供重启判断/)
  assert.throws(() => configurationSaveSummary({ success: false, revision: 'r1' }), /未提供完整保存回执/)
  assert.match(configurationSaveSummary({ success: true, revision: 'r1' }, 'en'), /^Configuration saved/)
})
