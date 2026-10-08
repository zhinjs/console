import test from 'node:test'
import assert from 'node:assert/strict'
import { pluginConfigFormState } from '../console-ui/src/components/PluginConfigForm/form-state.mjs'
test('read failures and disconnected state do not become a no-schema YAML fallback', () => {
  assert.equal(pluginConfigFormState({ loading: true, error: null, connected: true }), 'loading')
  assert.equal(pluginConfigFormState({ loading: false, error: 'not readable', connected: true }), 'error')
  assert.equal(pluginConfigFormState({ loading: false, error: null, connected: false }), 'disconnected')
  assert.equal(pluginConfigFormState({ loading: false, error: null, connected: true }), 'no-schema')
  assert.equal(pluginConfigFormState({ loading: false, connected: true, schema: { properties: {} } }), 'no-schema')
})
test('a schema enables form only after a connected successful read', () => {
  const schema = { object: { name: { type: 'string' } } }
  assert.equal(pluginConfigFormState({ loading: false, connected: true, schema }), 'ready')
  assert.equal(pluginConfigFormState({ loading: false, connected: true, schema, error: 'read failed' }), 'error')
  assert.equal(pluginConfigFormState({ loading: false, connected: false, schema }), 'disconnected')
})
