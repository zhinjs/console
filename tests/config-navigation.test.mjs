import assert from 'node:assert/strict'
import test from 'node:test'
import { configSectionKeys, resolveConfigSection } from '../console-ui/src/pages/config-navigation.mjs'

test('configuration defaults to the first schema section, including unconfigured Host sections', () => {
  const keys = configSectionKeys({ configVersion: 2, plugins: {}, http: {}, custom: {}, disable_plugins: [] }, ['http', 'speech', 'plugin'])
  assert.deepEqual(keys, ['http', 'speech', 'plugin', 'custom'])
  assert.equal(resolveConfigSection('general', keys), 'plugin:http')
  assert.equal(resolveConfigSection('plugin:removed', keys), 'plugin:http')
  assert.equal(resolveConfigSection('plugin:speech', keys), 'plugin:speech')
  assert.equal(resolveConfigSection('plugin:custom', keys), 'plugin:custom')
  assert.equal(resolveConfigSection('yaml', keys), 'yaml')
  assert.equal(resolveConfigSection('general', []), 'declarations')
})
