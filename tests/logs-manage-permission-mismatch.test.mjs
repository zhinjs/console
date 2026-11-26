import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveConsoleHttpPermission } from '@zhin.js/console-protocol'
import { logManageAccess } from '../console-ui/src/pages/logs/read-state.mjs'

// #64 `logs-manage-permission-mismatch`: 「清空」「清理」 (DELETE /logs, POST /logs/cleanup) were gated on
// ops.config.write, while the protocol requires ops.database.write for both: a custom role with only
// ops.config.write could press them and be refused; one with only ops.database.write did not see them.
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('managing logs needs what the protocol requires for DELETE /logs and POST /logs/cleanup', () => {
  const required = new Set([resolveConsoleHttpPermission('DELETE', '/logs')?.permission, resolveConsoleHttpPermission('POST', '/logs/cleanup')?.permission])
  assert.deepEqual([...required], ['ops.database.write'])
  const configOnly = new Set(['status.view', 'ops.config.write'])
  const databaseOnly = new Set(['status.view', 'ops.database.write'])
  assert.deepEqual(logManageAccess(name => configOnly.has(name)), { allowed: false, missing: ['ops.database.write'] })
  assert.deepEqual(logManageAccess(name => databaseOnly.has(name)), { allowed: true, missing: [] })
})

test('both the log page and the log viewer decide with logManageAccess, not ops.config.write', () => {
  for (const file of ['pages/logs.tsx', 'pages/logs/LogViewer.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /ops\.config\.write/u, file)
    assert.match(source, /const readOnly = !logManageAccess\(name => hasConsolePermission\(name\)\)\.allowed/u, file)
  }
})
