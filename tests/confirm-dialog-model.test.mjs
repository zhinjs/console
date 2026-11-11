import assert from 'node:assert/strict'
import test from 'node:test'
import { canSubmitConfirm, confirmErrorMessage, confirmTextMatches } from '../console-ui/src/components/confirm-dialog-model.mjs'
import { dropThenRefresh, withoutDroppedTables } from '../console-ui/src/pages/database/drop-table-model.mjs'

test('confirmErrorMessage reads Error, string and message-like rejections; blank or unknown fall back', () => {
  assert.equal(confirmErrorMessage(new Error('磁盘已满')), '磁盘已满')
  assert.equal(confirmErrorMessage('权限不足'), '权限不足')
  assert.equal(confirmErrorMessage({ message: ' 超时 ' }), '超时')
  for (const value of [undefined, null, 42, {}, new Error(''), '   ']) assert.equal(confirmErrorMessage(value), null)
})

test('typed confirmation requires an exact, case-sensitive match of the expected name', () => {
  assert.equal(confirmTextMatches('users', 'users'), true)
  assert.equal(confirmTextMatches('  users ', 'users'), true, 'surrounding whitespace from copy/paste is ignored')
  for (const typed of ['', 'user', 'Users', 'users2', 'us ers']) assert.equal(confirmTextMatches(typed, 'users'), false, typed)
  assert.equal(confirmTextMatches('', undefined), true, 'no confirmText means no typing is required')
  assert.equal(confirmTextMatches('', ''), true)
  assert.equal(confirmTextMatches('表_1', '表_1'), true)
})

test('canSubmitConfirm blocks while loading and until the typed name matches', () => {
  assert.equal(canSubmitConfirm({ loading: false, typed: '' }), true)
  assert.equal(canSubmitConfirm({ loading: true, typed: '' }), false)
  assert.equal(canSubmitConfirm({ loading: false, typed: 'log', confirmText: 'logs' }), false)
  assert.equal(canSubmitConfirm({ loading: false, typed: 'logs', confirmText: 'logs' }), true)
  assert.equal(canSubmitConfirm({ loading: true, typed: 'logs', confirmText: 'logs' }), false)
})

test('dropThenRefresh reports a refresh failure separately from a successful drop', async () => {
  const ok = await dropThenRefresh(async () => 'dropped', async () => {})
  assert.deepEqual(ok, { result: 'dropped', refreshError: null })
  const stale = await dropThenRefresh(async () => 'dropped', async () => { throw new Error('刷新失败') })
  assert.equal(stale.result, 'dropped')
  assert.match(stale.refreshError.message, /刷新失败/)
  const odd = await dropThenRefresh(async () => 1, () => Promise.reject(undefined))
  assert.ok(odd.refreshError, 'even an empty rejection counts as a refresh failure')
  let refreshed = false
  await assert.rejects(dropThenRefresh(async () => { throw new Error('无权限') }, async () => { refreshed = true }), /无权限/)
  assert.equal(refreshed, false)
})

test('withoutDroppedTables hides dropped names only from the stale snapshot they were dropped from', () => {
  const tables = [{ name: 'users' }, { name: 'logs' }]
  assert.strictEqual(withoutDroppedTables(tables, null), tables)
  assert.deepEqual(withoutDroppedTables(tables, { source: tables, names: ['users'] }), [{ name: 'logs' }])
  const fresh = [{ name: 'users' }]
  assert.strictEqual(withoutDroppedTables(fresh, { source: tables, names: ['users'] }), fresh, 'a newer server list wins, e.g. a recreated table')
})
