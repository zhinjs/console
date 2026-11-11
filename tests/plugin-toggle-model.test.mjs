import test from 'node:test'
import assert from 'node:assert/strict'
import { disableConfirmation, toggleFeedback, withPendingToggle } from '../console-ui/src/pages/plugin-toggle-model.mjs'
import { pluginDetailView } from '../console-ui/src/pages/plugin-detail-model.mjs'

test('disabling an adapter plugin warns that its chat accounts go offline', () => {
  const adapter = disableConfirmation({ name: 'qq', features: [{ name: 'adapter', count: 2 }, { name: 'command', count: 5 }] })
  assert.equal(adapter.title, '停用 qq？')
  assert.equal(adapter.variant, 'destructive')
  assert.equal(adapter.confirmLabel, '停用')
  assert.match(adapter.description, /2 个聊天账号会掉线/)
  const unknownAccounts = disableConfirmation({ name: 'qq', features: [{ name: 'adapter', count: 0 }] })
  assert.match(unknownAccounts.description, /适配器插件/)
  assert.match(unknownAccounts.description, /掉线/)
  const generic = disableConfirmation({ name: 'repeater', features: [{ name: 'command', count: 1 }] })
  assert.match(generic.description, /命令、中间件等功能将不可用/)
  assert.doesNotMatch(generic.description, /2 个/)
  // A list row without readable features still gets a cautious description rather than throwing.
  assert.match(disableConfirmation({ name: 'x' }).description, /功能将不可用/)
  const english = disableConfirmation({ name: 'qq', features: [{ name: 'adapter', count: 2 }] }, 'en')
  assert.equal(english.title, 'Disable qq?')
  assert.match(english.description, /2 chat accounts/)
})

test('toggle feedback reports success, a timeout with the Host reply, and a thrown failure', () => {
  const state = { disabled: false }
  assert.deepEqual(toggleFeedback({ name: 'qq', enabled: true, result: state }).variant, 'success')
  assert.match(toggleFeedback({ name: 'qq', enabled: false, result: { disabled: true } }).description, /已停用 qq/)
  const timeout = toggleFeedback({ name: 'qq', enabled: true, result: null })
  assert.equal(timeout.variant, 'error')
  assert.equal(timeout.title, '启用 qq 的结果未确认')
  assert.match(timeout.description, /超时/)
  const rejected = toggleFeedback({ name: 'qq', enabled: false, result: null, rpcError: new Error('permission denied') })
  assert.equal(rejected.title, '停用 qq 的结果未确认')
  assert.match(rejected.description, /permission denied/)
  const failed = toggleFeedback({ name: 'qq', enabled: false, error: new Error('inspect failed') })
  assert.equal(failed.title, '停用 qq 失败')
  assert.match(failed.description, /inspect failed/)
  assert.match(toggleFeedback({ name: 'qq', enabled: true, error: 'boom' }).description, /boom/)
  assert.equal(toggleFeedback({ name: 'qq', enabled: true, result: null }, 'en').title, 'Could not confirm enabling qq')
})

test('pending toggle sets are replaced, never mutated, so React sees every change', () => {
  const empty = new Set()
  const one = withPendingToggle(empty, 'a', true)
  assert.notStrictEqual(one, empty)
  assert.equal(empty.size, 0)
  assert.deepEqual([...one], ['a'])
  const two = withPendingToggle(one, 'b', true)
  assert.deepEqual([...two].sort(), ['a', 'b'])
  const back = withPendingToggle(two, 'a', false)
  assert.deepEqual([...back], ['b'])
  assert.deepEqual([...two].sort(), ['a', 'b'])
})

test('plugin detail keeps shown content while refreshing and turns refresh errors into an inline notice', () => {
  const plugin = { name: 'qq' }
  assert.deepEqual(pluginDetailView({ loading: true, plugin: null, error: null }), { view: 'skeleton', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin: null, error: 'HTTP 500' }), { view: 'error', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin: null, error: null }), { view: 'error', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: true, plugin, error: null }), { view: 'content', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin, error: 'HTTP 500' }), { view: 'content', staleError: 'HTTP 500' })
  assert.deepEqual(pluginDetailView({ loading: true, plugin, error: 'HTTP 500' }), { view: 'content', staleError: 'HTTP 500' })
})
