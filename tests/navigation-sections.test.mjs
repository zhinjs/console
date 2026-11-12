import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NAV_SECTIONS, NAV_TIERS, ROUTE_PERMISSIONS, buildNavigation, canSeeRoute, resolveSectionId, routePermissions, routeSectionId,
} from '../console-ui/src/navigation-sections.mjs'
import { CONSOLE_PATHS } from '../console-ui/src/console-routes.mjs'
import {
  UNRESTRICTED_ACCESS, createConsoleAccess, getConsoleAccess, hasConsolePermission, resetConsoleAccess, setConsoleAccess, subscribeConsoleAccess,
} from '../console-ui/src/utils/console-access.mjs'

const access = permissions => createConsoleAccess({ permissions })
const route = (path, group, extra = {}) => ({ path, name: path, meta: { group, ...extra.meta }, ...extra, ...(extra.meta ? { meta: { group, ...extra.meta } } : {}) })
const pages = [
  route('/dashboard', '概览', { meta: { order: 0 } }),
  route('/logs', '概览', { meta: { order: 1 } }),
  route('/scope', '会话'),
  route('/features', '功能'),
  route('/features/ai', '功能'),
  route('/plugins', '插件'),
  route('/ops/database', '运维', { meta: { order: 0 } }),
  route('/ops/config', '运维', { meta: { order: 1 } }),
  route('/ops/env', '运维', { meta: { order: 2 } }),
  route('/ops/schedules', '运维', { meta: { order: 3 } }),
  route('/ops/files', '运维', { meta: { order: 4 } }),
  route('/plugins/:name', '插件', { meta: { hideInMenu: true } }),
]
const shape = navigation => navigation.map(tier => [tier.id, tier.sections.map(section => [section.id, section.routes.map(item => item.path)])])

test('six sections, four daily and two admin, in ADR order', () => {
  assert.deepEqual(NAV_SECTIONS.map(section => [section.id, section.label, section.tier]), [
    ['overview', '概览', 'daily'], ['sessions', '会话', 'daily'], ['features', '功能', 'daily'], ['plugins', '插件', 'daily'],
    ['ops', '运维', 'admin'], ['access', '访问控制', 'admin'],
  ])
  assert.deepEqual(NAV_TIERS.map(tier => tier.label), ['日常', '管理'])
  assert.equal(resolveSectionId('ops'), 'ops')
  assert.equal(resolveSectionId(' 运维 '), 'ops')
  assert.equal(resolveSectionId('高级'), null)
  assert.equal(resolveSectionId(undefined), null)
})

test('pages without a section default to 功能; a declared section beats the group', () => {
  assert.equal(routeSectionId({ path: '/x' }), 'features')
  assert.equal(routeSectionId({ path: '/x', meta: { group: 'My tools' } }), 'features')
  assert.equal(routeSectionId({ path: '/x', meta: { group: '运维' } }), 'ops')
  assert.equal(routeSectionId({ path: '/x', meta: { group: '运维', section: 'overview' } }), 'overview')
  assert.equal(routeSectionId({ path: '/x', section: 'plugins' }), 'plugins')
})

test('an unrestricted session (every Host before RBAC) sees every section that has a page', () => {
  assert.deepEqual(shape(buildNavigation(pages)), [
    ['daily', [['overview', ['/dashboard', '/logs']], ['sessions', ['/scope']], ['features', ['/features', '/features/ai']], ['plugins', ['/plugins']]]],
    ['admin', [['ops', ['/ops/database', '/ops/config', '/ops/env', '/ops/schedules', '/ops/files']]]],
  ])
  assert.ok(!shape(buildNavigation(pages)).flat(3).includes('/plugins/:name'), 'hidden pages are not menu items')
})

test('sections without a visible page disappear for restricted principals', () => {
  // ADR 0049 viewer: every *.view / *.read except config and env reads.
  const viewer = access(['status.view', 'endpoint.view', 'feature.view', 'agent.view', 'ops.database.read', 'ops.schedule.read', 'ops.files.read'])
  assert.deepEqual(shape(buildNavigation(pages, viewer)), [
    ['daily', [['overview', ['/dashboard', '/logs']], ['sessions', ['/scope']], ['features', ['/features', '/features/ai']]]],
    ['admin', [['ops', ['/ops/database', '/ops/schedules', '/ops/files']]]],
  ])
  // ADR 0049 operator: no plugin or ops pages except schedules.
  const operator = access(['status.view', 'endpoint.view', 'endpoint.operate', 'feature.view', 'feature.configure', 'feature.toggle', 'agent.view', 'ops.schedule.read'])
  assert.deepEqual(shape(buildNavigation(pages, operator)).map(([tier, sections]) => [tier, sections.map(([id]) => id)]), [
    ['daily', ['overview', 'sessions', 'features']], ['admin', ['ops']],
  ])
  assert.deepEqual(shape(buildNavigation(pages, access(['endpoint.view']))), [['daily', [['sessions', ['/scope']]]]])
  assert.deepEqual(buildNavigation(pages, access([])), [], 'no permission, no navigation')
})

test('wildcard grants and route requiredPermissions are honoured', () => {
  assert.deepEqual(shape(buildNavigation(pages, access(['ops.*']))), [['admin', [['ops', ['/ops/database', '/ops/config', '/ops/env', '/ops/schedules', '/ops/files']]]]])
  assert.equal(buildNavigation(pages, access(['*'])).flatMap(tier => tier.sections).length, 5)
  const usage = { path: '/agent/usage', meta: { group: '概览' }, requiredPermissions: ['control:read'] }
  assert.equal(canSeeRoute(usage, access(['status.view'])), false, 'a page-level requirement must also be granted')
  assert.equal(canSeeRoute(usage, access(['status.view', 'control:read'])), true)
  assert.equal(canSeeRoute(usage, UNRESTRICTED_ACCESS), true)
})

test('plugin pages in a section use that section permission set', () => {
  const backup = { path: '/backup', meta: { section: 'ops' } }
  assert.deepEqual(routePermissions(backup), NAV_SECTIONS.find(section => section.id === 'ops').permissions)
  assert.equal(canSeeRoute(backup, access(['ops.files.read'])), true)
  assert.equal(canSeeRoute(backup, access(['status.view'])), false)
})

test('every builtin page path has an explicit permission set from the ADR 0049 catalog', () => {
  const catalog = /^(status\.view|endpoint\.(view|operate|manage)|feature\.(view|configure|toggle)|plugin\.manage|agent\.(view|configure)|ops\.(config|env|database|schedule|files)\.(read|write)|ops\.restart|ops\.terminal|iam\.(view|manage))$/
  for (const path of Object.values(CONSOLE_PATHS)) assert.ok(Object.hasOwn(ROUTE_PERMISSIONS, path), path)
  for (const [path, names] of Object.entries(ROUTE_PERMISSIONS)) for (const name of names) assert.match(name, catalog, `${path}: ${name}`)
})

test('the access store reports changes and treats a missing report as unrestricted', () => {
  let calls = 0
  const off = subscribeConsoleAccess(() => { calls++ })
  try {
    assert.equal(getConsoleAccess().unrestricted, true)
    setConsoleAccess({ permissions: ['status.view', ' ', 'ops.*', 42] })
    assert.equal(getConsoleAccess().unrestricted, false)
    assert.deepEqual([...getConsoleAccess().permissions], ['status.view', 'ops.*'])
    assert.equal(hasConsolePermission('ops.env.write'), true)
    assert.equal(hasConsolePermission('plugin.manage'), false)
    setConsoleAccess({})
    assert.equal(getConsoleAccess().unrestricted, true, 'no permission list means the Host reported nothing')
    resetConsoleAccess()
    assert.equal(calls, 3)
  } finally { off(); resetConsoleAccess() }
})
