import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CONSOLE_REST } from '../console-ui/src/contracts/zhin-console.ts'
import { resolveConsoleHttpPermission } from '@zhin.js/console-protocol'
import { TASK_WRITE_PERMISSIONS, TASK_WRITE_UNMAPPED, taskRoutePermission, taskWriteAccess } from '../console-ui/src/pages/task-center-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `task-center-permission-mismatch`: 管理员任务中心 enabled create / change by `ops.schedule.write`,
// while the Host (`CONSOLE_HTTP_PERMISSIONS`) requires `feature.configure` for POST /tasks/create and
// /tasks/change. The built-in operator (feature.configure, no ops.schedule.write) was shut out of what the
// Host allows; a custom role with only ops.schedule.write was let in and then refused with 403.
const required = path => resolveConsoleHttpPermission('POST', path)?.permission

test('the write permission is the one the protocol requires for every route the page posts to', () => {
  const routes = [CONSOLE_REST.TASK_CREATE, CONSOLE_REST.TASK_CHANGE].map(path => path.replace(/^\/api/u, ''))
  assert.deepEqual([...TASK_WRITE_PERMISSIONS].sort(), [...new Set(routes.map(required))].sort())
  assert.deepEqual([...TASK_WRITE_PERMISSIONS], ['feature.configure'])
})

test('an operator (feature.configure) may write; a role with only ops.schedule.write may not, and is told what is missing', () => {
  const operator = new Set(['feature.view', 'feature.configure', 'endpoint.operate'])
  const schedulerOnly = new Set(['feature.view', 'ops.schedule.write'])
  assert.deepEqual(taskWriteAccess(name => operator.has(name)), { allowed: true, missing: [] })
  assert.deepEqual(taskWriteAccess(name => schedulerOnly.has(name)), { allowed: false, missing: ['feature.configure'] })
})

test('the page decides with taskWriteAccess and names the missing permission', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /ops\.schedule\.write/u)
  assert.match(page, /const writeAccess = taskWriteAccess\(name => hasConsolePermission\(name\)\)/u)
  assert.match(page, /readOnly = !writeAccess\.allowed/u)
  assert.match(page, /i18n\.t\("当前身份缺少「\{0\}」权限，创建、修改、暂停、恢复和取消均已禁用。", \[writeAccess\.missing\.map\(name => permissionLabel\(name, i18n\.t\)\)\.join\(i18n\.t\('、'\)\)\]\)/u)
  assert.doesNotMatch(translate('en', '当前身份缺少「{0}」权限，创建、修改、暂停、恢复和取消均已禁用。', ['x']), /[一-鿿]/u)
})

test('a route the protocol does not map is never writable (the Host would deny it); open rules need no permission', () => {
  assert.equal(TASK_WRITE_UNMAPPED, false, 'protocol 1.10 maps both routes')
  assert.equal(taskRoutePermission(null), null)
  assert.equal(taskRoutePermission({ permission: 'rpc' }), null)
  assert.equal(taskRoutePermission({ permission: 'bootstrap' }), null)
  assert.equal(taskRoutePermission({ permission: 'authenticated' }), '')
  assert.equal(taskRoutePermission({ permission: 'feature.configure' }), 'feature.configure')
  assert.deepEqual(taskWriteAccess(() => true, true), { allowed: false, missing: [] }, 'unmapped: disabled for everyone, not open')
  assert.doesNotMatch(translate('en', '当前协议没有登记管理员任务的写入权限，Host 会拒绝写入；创建、修改、暂停、恢复和取消均已禁用。'), /[一-鿿]/u)
})

test('wildcard grants and unrestricted sessions pass through hasConsolePermission', async () => {
  const { hasConsolePermission } = await import('../console-ui/src/utils/console-access.mjs')
  const access = permissions => ({ unrestricted: false, permissions: new Set(permissions), scoped: [] })
  assert.equal(taskWriteAccess(name => hasConsolePermission(name, access(['feature.*']))).allowed, true)
  assert.equal(taskWriteAccess(name => hasConsolePermission(name, access(['*']))).allowed, true)
  assert.equal(taskWriteAccess(name => hasConsolePermission(name, { unrestricted: true })).allowed, true)
  assert.equal(taskWriteAccess(name => hasConsolePermission(name, access(['ops.schedule.write', 'ops.schedule.read']))).allowed, false)
})
