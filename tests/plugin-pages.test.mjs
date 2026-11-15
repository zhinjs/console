import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describePluginPage, normalizePageKeywords, pluginNameFromOwner, pluginPageIdentity, pluginPagePath, pluginDetailPath,
  pluginTabsOf, readPluginDirectory, setPluginDirectory, pluginDirectory, subscribePluginDirectory,
  warnIgnoredSection, resetIgnoredSectionWarnings, PLUGIN_OVERVIEW_TAB,
} from '../console-ui/src/plugin-pages.mjs'
import {
  LEGACY_ROUTE_REDIRECTS, clearPluginPageRedirects, isPluginPageRedirect, registerPluginPageRedirect, resolveLegacyRedirect,
} from '../console-ui/src/console-routes.mjs'

test('plugin and page names follow the Host page paths (pages/index -> /<plugin>, pages/<name> -> /<plugin>/p-<name>)', () => {
  assert.equal(pluginNameFromOwner('root/rss'), 'rss')
  assert.equal(pluginNameFromOwner('root/group/rss'), 'rss', 'nested instances are named by their instance key')
  assert.equal(pluginNameFromOwner('rss'), 'rss')
  for (const owner of ['root', '', null, undefined, 3]) assert.equal(pluginNameFromOwner(owner), null)
  assert.deepEqual(pluginPageIdentity('/rss', 'root/rss'), { plugin: 'rss', page: 'index' })
  assert.deepEqual(pluginPageIdentity('/rss/p-history', 'root/rss'), { plugin: 'rss', page: 'history' })
  assert.deepEqual(pluginPageIdentity('/group/rss', 'root/group/rss'), { plugin: 'rss', page: 'index' })
  assert.deepEqual(pluginPageIdentity('/calendar'), { plugin: 'calendar', page: 'index' }, 'without an owner the first segment names the plugin')
  assert.deepEqual(pluginPageIdentity('/calendar/month'), { plugin: 'calendar', page: 'month' })
  assert.equal(pluginPageIdentity('/p-backup'), null, 'the project\'s own pages have no plugin')
  assert.equal(pluginPageIdentity('/p-backup', 'root'), null)
  for (const route of ['', 'rss', '/', null]) assert.equal(pluginPageIdentity(route), null)
  assert.equal(pluginPagePath('rss', 'index'), '/plugins/rss/index')
  assert.equal(pluginPagePath('a b', 'x'), '/plugins/a%20b/x')
  assert.equal(pluginDetailPath('rss'), '/plugins/rss')
  assert.equal(PLUGIN_OVERVIEW_TAB, 'overview')
})

test('page keywords are read defensively: string[], { [locale]: string[] }, or ignored', () => {
  assert.deepEqual(normalizePageKeywords(['抽奖', ' 抽奖 ', '', 3, 'lottery']), ['抽奖', 'lottery'])
  assert.deepEqual(normalizePageKeywords({ 'zh-CN': ['抽奖', '摇号'], en: ['raffle'] }), ['抽奖', '摇号', 'raffle'], 'every language is searchable')
  assert.deepEqual(normalizePageKeywords({ en: 'raffle', fr: [{}] }), ['raffle'])
  assert.deepEqual(normalizePageKeywords('抽奖'), ['抽奖'])
  for (const value of [undefined, null, 42, true, [[['deep']]], { a: { b: ['nested'] } }]) assert.deepEqual(normalizePageKeywords(value), [], String(value))
  assert.deepEqual(normalizePageKeywords(['a'], { en: ['a', 'b'] }, undefined), ['a', 'b'], 'several sources merge without duplicates')
})

test('an /entries item describes its page from the top level, meta or metadata', () => {
  assert.deepEqual(describePluginPage({
    id: 'index', name: 'index', owner: 'root/lottery', route: '/lottery', description: '选号与开奖',
    meta: { section: 'features', keywords: { 'zh-CN': ['抽奖'] } }, metadata: { keywords: ['raffle'] },
  }), { legacyPath: '/lottery', plugin: 'lottery', page: 'index', keywords: ['抽奖', 'raffle'], section: 'features', description: '选号与开奖' })
  assert.deepEqual(describePluginPage({ id: 'rss', owner: 'rss', route: '/rss', packageName: '@zhin.js/plugin-rss', plugin: { description: '订阅 RSS' } }),
    { legacyPath: '/rss', plugin: 'rss', page: 'index', keywords: [], packageName: '@zhin.js/plugin-rss', pluginDescription: '订阅 RSS' })
  assert.equal(describePluginPage({ id: 'calendar' }).legacyPath, '/calendar', 'the id stands in for a missing route')
  assert.equal(describePluginPage({ id: 'x', owner: 'root/github', route: '/github', blueprint: { kind: 'zhin.console.adapter-page', adapterKey: 'github' } }).adapterKey, 'github')
  assert.equal(describePluginPage({ id: 'x', owner: 'root/rss', route: '/rss', blueprint: { kind: 'zhin.console.page-blueprint' } }).adapterKey, undefined)
  for (const entry of [null, undefined, 'x', {}, { route: 'relative' }]) assert.equal(describePluginPage(entry), null)
})

test('a plugin\'s tabs: only its own visible pages, index first, then by order', () => {
  const tab = (path, plugin, page, extra = {}) => ({ path, meta: { order: extra.order, pluginTab: { kind: 'tab', plugin, page, href: path, hidden: extra.hidden } } })
  const routes = [
    { path: '/plugins/:name', meta: {} },
    tab('/plugins/rss/b', 'rss', 'b', { order: 5 }),
    tab('/plugins/rss/a', 'rss', 'a', { order: 1 }),
    tab('/plugins/rss/index', 'rss', 'index', { order: 9 }),
    tab('/plugins/rss/raw', 'rss', 'raw', { hidden: true }),
    tab('/plugins/lottery/index', 'lottery', 'index'),
    { path: '/icqq', meta: { pluginTab: { kind: 'adapter', plugin: 'rss', page: 'index', href: '/scope/icqq' } } },
  ]
  assert.deepEqual(pluginTabsOf(routes, ['rss']).map(route => route.path), ['/plugins/rss/index', '/plugins/rss/a', '/plugins/rss/b'])
  assert.deepEqual(pluginTabsOf(routes, [undefined, '@zhin.js/plugin-lottery', 'lottery']).map(route => route.path), ['/plugins/lottery/index'])
  assert.deepEqual(pluginTabsOf(routes, 'none'), [])
  assert.deepEqual(pluginTabsOf(null, 'rss'), [])
})

test('the plugin directory keeps package names and descriptions by instance key and name', () => {
  const directory = readPluginDirectory({ success: true, data: [
    { name: 'lottery', instanceKey: 'lottery-main', packageName: '@zhin.js/plugin-lottery', description: '彩票推荐' },
    { name: 'rss', instanceKey: 'rss' }, null, 'junk',
  ] })
  assert.deepEqual(directory['lottery-main'], { name: 'lottery', packageName: '@zhin.js/plugin-lottery', description: '彩票推荐' })
  assert.equal(directory.lottery, directory['lottery-main'])
  assert.deepEqual(directory.rss, { name: 'rss' })
  assert.deepEqual(readPluginDirectory(null), {})
  assert.deepEqual(readPluginDirectory([{ instanceKey: 'x', packageName: 'pkg-x' }]).x, { packageName: 'pkg-x' })
  let calls = 0
  const stop = subscribePluginDirectory(() => { calls += 1 })
  setPluginDirectory(directory)
  assert.equal(pluginDirectory(), directory)
  setPluginDirectory(null)
  assert.deepEqual(pluginDirectory(), {})
  stop()
  setPluginDirectory(directory)
  assert.equal(calls, 2)
  setPluginDirectory(null)
})

test('a page that still declares metadata.section is warned about once', () => {
  resetIgnoredSectionWarnings()
  const messages = []
  const logger = { warn: message => messages.push(message) }
  assert.equal(warnIgnoredSection('/rss', 'ops', logger), true)
  assert.equal(warnIgnoredSection('/rss', 'ops', logger), false)
  assert.equal(warnIgnoredSection('/calendar', undefined, logger), false)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /\/rss declares section "ops"/)
  resetIgnoredSectionWarnings()
})

test('old plugin page paths redirect to their tab, keeping the query; builtin redirects stay authoritative', () => {
  clearPluginPageRedirects()
  try {
    assert.equal(resolveLegacyRedirect('/rss'), null)
    registerPluginPageRedirect('/rss', '/plugins/rss/index')
    registerPluginPageRedirect('/icqq', '/scope/icqq')
    assert.equal(isPluginPageRedirect('/rss'), true)
    assert.equal(resolveLegacyRedirect('/rss', '?feed=1'), '/plugins/rss/index?feed=1')
    assert.equal(resolveLegacyRedirect('/rss/'), '/plugins/rss/index')
    assert.equal(resolveLegacyRedirect('/icqq'), '/scope/icqq')
    // A plugin cannot take over a builtin legacy path, a relative path or its own target.
    registerPluginPageRedirect('/config', '/plugins/config/index')
    assert.equal(isPluginPageRedirect('/config'), false)
    assert.equal(resolveLegacyRedirect('/config'), LEGACY_ROUTE_REDIRECTS['/config'].to)
    registerPluginPageRedirect('rss', '/plugins/rss/index')
    registerPluginPageRedirect('/same', '/same')
    assert.equal(isPluginPageRedirect('rss') || isPluginPageRedirect('/same'), false)
  } finally { clearPluginPageRedirects() }
  assert.equal(resolveLegacyRedirect('/rss'), null, 'signing out forgets them')
})
