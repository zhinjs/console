import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ROUTE_PERMISSIONS, canSeeRoute as routeReachable } from '../console-ui/src/navigation-sections.mjs'
import { readableTaskTabs, resolveTaskTab, TASK_HUB_READ_PERMISSIONS, TASK_HUB_TABS, taskTabPermission, unreadableTaskTab } from '../console-ui/src/pages/task-hub-model.mjs'
import { taskOverviewRows } from '../console-ui/src/pages/task-overview-model.mjs'

// #64 `schedules-nav-task-center-permission`: 定时任务 was reachable only with ops.schedule.read / write,
// while its 管理员任务 tab reads GET /tasks/providers (feature.view in the protocol, #213): a role with
// feature.view / feature.configure but no ops.schedule.* could not open the page the Host lets it use.
const access = permissions => ({ unrestricted: false, permissions: new Set(permissions), scoped: [] })
const has = permissions => name => permissions.includes(name)

test('the entry shows when any tab is readable, by the protocol table', () => {
  assert.deepEqual([...TASK_HUB_READ_PERMISSIONS].sort(), ['feature.view', 'ops.schedule.read'])
  assert.deepEqual([...ROUTE_PERMISSIONS['/ops/schedules']].sort(), ['feature.view', 'ops.schedule.read'])
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['feature.view', 'feature.configure'])), true, 'task-center-only role')
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['ops.schedule.read'])), true)
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['status.view'])), false)
  // Write alone reads no tab: the shell's 无权限 state, not an empty page.
  assert.equal(routeReachable({ path: '/ops/schedules' }, access(['ops.schedule.write'])), false)
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

test('a ?tab= the identity cannot read names the permission it needs', () => {
  const tabs = readableTaskTabs(has(['feature.view']))
  assert.equal(resolveTaskTab('schedule', tabs), 'admin')
  assert.deepEqual(unreadableTaskTab('schedule', tabs), { tab: 'schedule', label: '定时提醒', permission: 'ops.schedule.read' })
  assert.equal(unreadableTaskTab('admin', tabs), null, 'readable')
  assert.equal(unreadableTaskTab('nope', tabs), null, 'unknown ids fall back silently')
  assert.equal(unreadableTaskTab(null, tabs), null)
  assert.equal(taskTabPermission('admin'), 'feature.view')
  assert.equal(taskTabPermission('overview'), null)
})

test('全部任务 does not read, link to or report a source the identity cannot read', () => {
  // ops.schedule.read without feature.view: 管理员任务 is not read (undefined), so it is not 「未能读取」.
  const { unavailable } = taskOverviewRows({ schedules: { memory: [], persistent: [] }, assistant: { jobs: [] } }, 'zh-CN')
  assert.deepEqual(unavailable, [])
  assert.deepEqual(taskOverviewRows({ admin: null, schedules: null, assistant: null }).unavailable, ['admin', 'schedule', 'assistant'])
  const overview = readFileSync(new URL('../console-ui/src/pages/TaskOverview.tsx', import.meta.url), 'utf8')
  assert.match(overview, /readsAdmin \? settle\(readJson\(`\$\{CONSOLE_REST\.TASK_PROVIDERS\}/u)
  assert.match(overview, /actions=\{readsAdmin \? /u, 'no 「创建管理员任务」 link without 管理员任务')
  assert.match(overview, /canRead\(row\.tab\) \? <Link/u)
  const page = readFileSync(new URL('../console-ui/src/pages/task-hub.tsx', import.meta.url), 'utf8')
  for (const tab of ['admin', 'schedule', 'assistant', 'history']) assert.match(page, new RegExp(`readable\\.includes\\('${tab}'\\) \\? \\(`, 'u'), `${tab} card`)
  assert.match(page, /useConsoleAccess\(\)/u, 'tabs follow when permissions arrive')
  assert.match(page, /unreadableTaskTab\(params\.get\('tab'\), tabs\)/u)
})
