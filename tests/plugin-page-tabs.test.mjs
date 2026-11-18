import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as pluginPages from '../console-ui/src/plugin-pages.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const navigation = compile(await source('i18n/navigation.ts'), { './locale.mjs': { translate } })
const tabsSource = await source('pages/plugin-page-tabs.tsx')

function render(props, { routes, locale = 'zh-CN', search = '' }) {
  const navigated = []
  const mocks = {
    react: { useMemo: fn => fn(), useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react-router-dom': { useNavigate: () => to => navigated.push(to), useSearchParams: () => [new URLSearchParams(search)] },
    '../i18n': { useI18n: () => ({ locale, t: (message, values) => translate(locale, message, values) }) },
    '../i18n/navigation': navigation,
    '../utils/console-client': { app: { subscribe() {}, getRoutes: () => routes } },
    '@zhin.js/console-ui': { Tabs: 'Tabs', TabsList: 'TabsList', TabsTrigger: 'TabsTrigger', TabsContent: 'TabsContent' },
    '../plugin-pages.mjs': pluginPages,
  }
  const { PluginPageTabs } = compile(tabsSource, mocks)
  return { tree: PluginPageTabs(props), navigated }
}

const tabRoute = (plugin, page, name, extra = {}) => ({
  path: pluginPages.pluginPagePath(plugin, page), name,
  meta: { hideInMenu: true, ...(extra.order === undefined ? {} : { order: extra.order }), ...(extra.titleI18n ? { titleI18n: extra.titleI18n } : {}),
    pluginTab: { kind: 'tab', plugin, page, href: pluginPages.pluginPagePath(plugin, page), legacyPath: `/${plugin}`, keywords: [], ...(extra.hidden ? { hidden: true } : {}) } },
})
const routes = [
  { path: '/plugins/:name', name: '插件详情', meta: { hideInMenu: true } },
  tabRoute('rss', 'history', '历史', { order: 2 }),
  tabRoute('rss', 'index', 'RSS 订阅', { titleI18n: { en: 'RSS feeds' } }),
  tabRoute('rss', 'raw', 'Raw', { hidden: true }),
  tabRoute('lottery', 'index', '彩票推荐'),
]
const triggers = tree => nodes(tree).filter(node => node.type === 'TabsTrigger').map(node => [node.props.value, text(node)])

test('the plugin detail page shows 概览 plus one tab per page the plugin contributes, named by the page title', () => {
  const { tree } = render({ plugin: 'rss', names: ['rss', 'rss', '@zhin.js/plugin-rss'], active: 'overview', overview: 'OVERVIEW', page: undefined }, { routes })
  assert.equal(tree.type, 'Tabs')
  assert.equal(tree.props.value, 'overview')
  assert.deepEqual(triggers(tree), [['overview', '概览'], ['/plugins/rss/index', 'RSS 订阅'], ['/plugins/rss/history', '历史']], 'its own visible pages only, index first')
  const panel = nodes(tree).find(node => node.type === 'TabsContent')
  assert.equal(panel.props.value, 'overview')
  assert.equal(text(panel), 'OVERVIEW', 'only the open tab is mounted')
  assert.equal(nodes(tree).find(node => node.type === 'TabsList').props['aria-label'], '插件页签')
  const english = render({ plugin: 'rss', names: ['rss'], active: 'overview', overview: 'OVERVIEW' }, { routes, locale: 'en' })
  assert.deepEqual(triggers(english.tree).map(([, label]) => label), ['Overview', 'RSS feeds', '历史'])
})

test('a page tab renders the plugin page and switching tabs changes the URL, keeping the plugin list search', () => {
  const { tree, navigated } = render({ plugin: 'rss', names: ['rss'], active: '/plugins/rss/history', overview: 'OVERVIEW', page: 'HISTORY PAGE' }, { routes, search: 'q=feed' })
  assert.equal(tree.props.value, '/plugins/rss/history')
  assert.equal(text(nodes(tree).find(node => node.type === 'TabsContent')), 'HISTORY PAGE')
  tree.props.onValueChange('overview')
  tree.props.onValueChange('/plugins/rss/index')
  assert.deepEqual(navigated, ['/plugins/rss?q=feed', '/plugins/rss/index?q=feed'])
  // A page hidden from navigation is still shown when opened by its path, without a tab of its own.
  const hidden = render({ plugin: 'rss', names: ['rss'], active: '/plugins/rss/raw', overview: 'OVERVIEW', page: 'RAW' }, { routes })
  assert.equal(text(nodes(hidden.tree).find(node => node.type === 'TabsContent')), 'RAW')
  assert.ok(!triggers(hidden.tree).some(([value]) => value === '/plugins/rss/raw'))
})

test('a plugin without pages keeps its plain 概览 (no tab bar)', () => {
  const { tree } = render({ plugin: 'repeater', names: ['repeater'], active: 'overview', overview: 'OVERVIEW' }, { routes })
  assert.notEqual(tree.type, 'Tabs')
  assert.equal(text(tree), 'OVERVIEW')
})

test('the detail page mounts the tabs with the plugin header, and page tabs are registered with the plugin detail element', async () => {
  const detail = await source('pages/plugin-detail.tsx')
  assert.match(detail, /<PluginPageTabs plugin=\{name \?\? ''\} names=\{\[name, plugin\?\.instanceKey, plugin\?\.packageName\]\} active=\{tab\?\.href \?\? PLUGIN_OVERVIEW_TAB\} page=\{tab \? <PageChromeProvider store=\{chromeStore\}>\{tab\.content\}<\/PageChromeProvider> : undefined\}/)
  // The open page tab hands its header actions and refresh control to the plugin header (usePageChrome).
  assert.match(detail, /const chromeStore = useMemo\(\(\) => createPageChromeStore\(\), \[tabHref\]\)/)
  assert.match(detail, /\{tab \? <PageChromeActions store=\{chromeStore\} \/> : null\}/)
  assert.match(detail, /\{tab && pageChrome\?\.refresh \? null : \(/, 'a page with its own refresh control replaces the header 刷新')
  assert.match(detail, /const name = pluginName \?\? params\.name/)
  const entries = await source('bootstrap/loadConsoleEntries.ts')
  assert.match(entries, /React\.createElement\(PluginDetailPage as React\.ComponentType<PluginDetailPageProps>, \{ plugin: tab\.plugin, tab: \{ href: tab\.href, content: route\.element \} \}\)/)
  assert.match(entries, /registerPluginPageRedirect\(plan\.redirect\.path, plan\.redirectTo\)/)
  assert.match(entries, /warnIgnoredSection\(route\.path, plan\.sectionIgnored\)/)
  assert.match(entries, /clearPluginPageRedirects\(\)/)
})
