import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ROUTE_PERMISSIONS, canSeeRoute as routeReachable } from '../console-ui/src/navigation-sections.mjs'
import { readableTaskTabs, TASK_HUB_READ_PERMISSIONS, TASK_HUB_TABS } from '../console-ui/src/pages/task-hub-model.mjs'

// #64 `schedules-nav-task-center-permission`: 定时任务 was reachable only with ops.schedule.read / write,
// while its 管理员任务 tab reads GET /tasks/providers (feature.view in the protocol, #213): a role with
// feature.view / feature.configure but no ops.schedule.* could not open the page the Host lets it use.
const access = permissions => ({ unrestricted: false, permissions: new Set(permissions), scoped: [] })
const has = permissions => name => permissions.includes(name)

test('the entry shows when any tab is readable, by the protocol table', () => {
  assert.deepEqual([...TASK_HUB_READ_PERMISSIONS].sort(), ['feature.view', 'ops.schedule.read'])
  for (const permission of ['feature.view', 'ops.schedule.read', 'ops.schedule.write']) assert.ok(ROUTE_PERMISSIONS['/ops/schedules'].includes(permission), permission)
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['feature.view', 'feature.configure'])), true, 'task-center-only role')
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['ops.schedule.read'])), true)
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['status.view'])), false)
})

test('only the tabs the identity can read are offered; the overview needs at least two sources', () => {
  const ids = permissions => readableTaskTabs(has(permissions)).map(tab => tab.id)
  assert.deepEqual(ids(['feature.view']), ['admin'], 'a task-center-only role opens straight on 管理员任务')
  assert.deepEqual(ids(['ops.schedule.read']), ['overview', 'schedule', 'assistant', 'history'])
  assert.deepEqual(ids(['feature.view', 'ops.schedule.read']), TASK_HUB_TABS.map(tab => tab.id))
  assert.deepEqual(ids([]), [])
})

test('the page offers readable tabs only, and an unreadable ?tab= falls back to the first readable one', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/task-hub.tsx', import.meta.url), 'utf8')
  assert.match(page, /const tabs = readableTaskTabs\(name => hasConsolePermission\(name\)\)/u)
  assert.match(page, /resolveTaskTab\(params\.get\('tab'\), tabs\)/u)
})
