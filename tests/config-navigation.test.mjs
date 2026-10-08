import assert from 'node:assert/strict'
import test from 'node:test'
import { generalConfigKeys, resolveConfigSection } from '../console-ui/src/pages/config-navigation.mjs'

test('configuration landing never selects an empty or removed category', () => {
  const keys = ['http', 'plugin']
  assert.deepEqual(generalConfigKeys({http: {}, plugin: {}, plugins: {}}, keys), [])
  assert.equal(resolveConfigSection('general', keys, false), 'plugin:http')
  assert.equal(resolveConfigSection('plugin:removed', keys, false), 'plugin:http')
  assert.equal(resolveConfigSection('plugin:plugin', keys, false), 'plugin:plugin')
  assert.equal(resolveConfigSection('yaml', keys, false), 'yaml')
  assert.equal(resolveConfigSection('general', [], false), 'yaml')
  assert.deepEqual(generalConfigKeys({http: {}, custom: {}, plugins: {}}, keys), ['custom'])
  assert.equal(resolveConfigSection('general', keys, true), 'general')
})
