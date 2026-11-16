import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { COMMAND_EXCLUDED_PATHS, ROUTE_SEARCH_HINTS, commandScore, isCommandRoute } from '../console-ui/src/components/command-center-model.mjs'
import { LEGACY_TASK_ROUTES } from '../console-ui/src/pages/task-hub-model.mjs'
import { CONSOLE_PATHS, LEGACY_ROUTE_REDIRECTS } from '../console-ui/src/console-routes.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const shell = await readFile(new URL('../console-ui/src/registerBuiltinShell.tsx', import.meta.url), 'utf8')
// Builtin pages are registered by `CONSOLE_PATHS` key (`path: P.dashboard`).
const builtinPaths = [...shell.matchAll(/app\.addRoute\(\{\s*path: P\.(\w+)/g)].map(match => CONSOLE_PATHS[match[1]])

test('palette routes include hidden pages but exclude parameterised, legacy redirect and opted-out routes', () => {
  assert.equal(isCommandRoute({ path: '/agent/replay', meta: { hideInMenu: true } }), true)
  assert.equal(isCommandRoute({ path: '/permissions', meta: { hideInMenu: true } }), true)
  assert.equal(isCommandRoute({ path: '/logs' }), true)
  assert.equal(isCommandRoute({ path: '/plugins/:name', meta: { hideInMenu: true } }), false)
  assert.equal(isCommandRoute({ path: '/scope/:adapter/:endpoint' }), false)
  assert.equal(isCommandRoute({ path: '/endpoints' }), false, 'legacy redirect')
  assert.equal(isCommandRoute({ path: '/files/*' }), false)
  assert.equal(isCommandRoute({ path: '/cron', meta: { hideInMenu: true } }), false)
  assert.equal(isCommandRoute({ path: '/assistant/jobs', meta: { hideInMenu: true } }), false)
  assert.equal(isCommandRoute({ path: '/plugin-internal', meta: { hideInMenu: true, commandPalette: false } }), false)
  for (const route of [null, undefined, {}, { path: '' }, { path: 'relative' }]) assert.equal(isCommandRoute(route), false)
  assert.deepEqual([...COMMAND_EXCLUDED_PATHS].sort(), Object.keys(LEGACY_ROUTE_REDIRECTS).sort(), 'exclusions follow the legacy redirects')
  for (const path of Object.keys(LEGACY_TASK_ROUTES)) assert.ok(COMMAND_EXCLUDED_PATHS.includes(path), path)
  for (const path of ['/config', '/agent/models', '/tasks']) assert.equal(isCommandRoute({ path, meta: { hideInMenu: true } }), false, path)
})

test('every builtin page reachable from the palette has a translated description and search keywords', () => {
  assert.ok(builtinPaths.length > 20)
  const reachable = builtinPaths.filter(path => isCommandRoute({ path }))
  assert.ok(builtinPaths.every(Boolean), 'every P.<key> names a CONSOLE_PATHS entry')
  for (const path of ['/features/ai/ambient', '/features/ai/skills', '/agent/usage', '/features/ai', '/features', '/scope', '/ops/config', '/scenario-lab', '/agent/replay', '/permissions']) assert.ok(reachable.includes(path), path)
  for (const path of reachable) {
    const hint = ROUTE_SEARCH_HINTS[path]
    assert.ok(hint, `${path} has a search hint`)
    assert.ok(hint.description.trim(), `${path} has a description`)
    assert.ok(Object.hasOwn(englishMessages, hint.description), `${path} description has an English entry`)
    assert.ok(hint.keywords.length >= 3 && hint.keywords.every(word => word.trim()), `${path} has keywords`)
  }
  const known = new Set([...builtinPaths, '/sandbox'])
  for (const path of Object.keys(ROUTE_SEARCH_HINTS)) assert.ok(known.has(path), `${path} hint belongs to a registered page`)
})

const target = (title, path, extra = {}) => ({ title, path, group: '运行维护', description: `打开 ${title}`, ...extra })

test('search matches keywords, requires every term and still ranks title matches first', () => {
  const usage = target('Token 用量', '/agent/usage', { keywords: ROUTE_SEARCH_HINTS['/agent/usage'].keywords })
  assert.equal(commandScore(usage, ''), 1)
  assert.ok(commandScore(usage, '花费') > 0)
  assert.ok(commandScore(usage, 'COST') > 0, 'case-insensitive')
  assert.equal(commandScore(target('Token 用量', '/agent/usage'), '花费'), 0, 'without keywords the purpose word misses')
  assert.ok(commandScore(usage, '花费 缓存命中') > 0)
  assert.equal(commandScore(usage, '花费 数据库'), 0, 'every term must match')
  const titled = target('花费统计', '/other')
  assert.ok(commandScore(titled, '花费') > commandScore(usage, '花费'), 'a title hit outranks a keyword hit')
  const exact = commandScore(usage, 'token'), partial = commandScore(target('X', '/x', { keywords: ['tokenizer'] }), 'token')
  assert.ok(exact > partial, 'an exact keyword outranks a partial one')
})

test('plugin pages: the palette opens their tab (or adapter object page) and searches plugin, package, titles and aliases', async () => {
  const { pluginPageCommand } = await import('../console-ui/src/components/command-center-model.mjs')
  const { registerPluginPageRedirect, clearPluginPageRedirects } = await import('../console-ui/src/console-routes.mjs')
  const { canSeeRoute } = await import('../console-ui/src/navigation-sections.mjs')
  const { createConsoleAccess } = await import('../console-ui/src/utils/console-access.mjs')
  const tab = { kind: 'tab', plugin: 'lottery', page: 'index', href: '/plugins/lottery/index', legacyPath: '/lottery', keywords: ['抽奖'] }
  const route = { path: '/plugins/lottery/index', name: '彩票推荐', meta: { group: '插件', hideInMenu: true, titleI18n: { en: 'Lottery picks' }, pluginTab: tab } }
  registerPluginPageRedirect('/lottery', '/plugins/lottery/index')
  registerPluginPageRedirect('/icqq', '/scope/icqq')
  try {
    assert.equal(isCommandRoute(route), true, 'a concrete tab path')
    assert.equal(isCommandRoute({ path: '/lottery', meta: { hideInMenu: true, commandPalette: false } }), false)
    assert.equal(isCommandRoute({ path: '/lottery' }), false, 'an old plugin path is excluded even without the opt-out')
    assert.equal(isCommandRoute({ path: '/icqq', meta: { pluginTab: { kind: 'adapter', plugin: 'adapter-icqq', page: 'index', href: '/scope/icqq', keywords: [] } } }), true, 'the adapter page keeps one entry')
  } finally { clearPluginPageRedirects() }
  assert.deepEqual(pluginPageCommand(route), { path: '/plugins/lottery/index', plugin: 'lottery', keywords: ['lottery', '彩票推荐', 'Lottery picks', '抽奖'] })
  const withDirectory = pluginPageCommand(route, { lottery: { name: 'lottery', packageName: '@zhin.js/plugin-lottery', description: '按规则推荐号码' } })
  assert.equal(withDirectory.packageName, '@zhin.js/plugin-lottery')
  assert.equal(withDirectory.description, '按规则推荐号码')
  assert.ok(withDirectory.keywords.includes('@zhin.js/plugin-lottery') && withDirectory.keywords.includes('按规则推荐号码'))
  const target = { title: '彩票推荐', path: withDirectory.path, group: '插件', description: '', keywords: withDirectory.keywords }
  for (const query of ['抽奖', 'plugin-lottery', '推荐号码', 'lottery picks']) assert.ok(commandScore(target, query) > 0, query)
  for (const other of [null, { path: '/logs' }, { path: '/x', meta: { pluginTab: { plugin: 'x' } } }]) assert.equal(pluginPageCommand(other), null)
  // A tab keeps the reach the page had in 功能 (plus plugin administrators); others do not see it.
  assert.equal(canSeeRoute(route, createConsoleAccess({ permissions: ['feature.view'] })), true)
  assert.equal(canSeeRoute(route, createConsoleAccess({ permissions: ['plugin.manage'] })), true)
  assert.equal(canSeeRoute(route, createConsoleAccess({ permissions: ['status.view'] })), false)
})
