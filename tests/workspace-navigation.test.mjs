import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { matchPath } from 'react-router-dom'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { resolveNavigationLocation } from '../console-ui/src/navigation-location.mjs'
import * as commandCenterModel from '../console-ui/src/components/command-center-model.mjs'
import * as sections from '../console-ui/src/navigation-sections.mjs'
import { createConsoleAccess, UNRESTRICTED_ACCESS } from '../console-ui/src/utils/console-access.mjs'
import { CONSOLE_PATHS, clearPluginPageRedirects, registerPluginPageRedirect } from '../console-ui/src/console-routes.mjs'
import * as scopeTree from '../console-ui/src/scope/scope-tree.mjs'
import * as logPanelModel from '../console-ui/src/components/log-panel/log-panel-model.mjs'
import * as logPanelStoreModule from '../console-ui/src/components/log-panel/log-panel-store.mjs'
import * as pluginPages from '../console-ui/src/plugin-pages.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return module.exports
}
const taxonomy = compile(await source('navigation-taxonomy.ts'), { './navigation-sections.mjs': sections, './console-routes.mjs': { CONSOLE_PATHS }, './plugin-pages.mjs': pluginPages })
const navigation = compile(await source('i18n/navigation.ts'), { './locale.mjs': { translate } })
const layoutSource = await source('layouts/dashboard.tsx')
const mobileHookSource = await source('hooks/useIsMobile.ts')
const commandSource = await source('components/ConsoleCommandCenter.tsx')
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ui = names => Object.fromEntries(names.map(name => [name, name]))
function fixture({ routes, path = '/sandbox', mobile = false, locale = 'zh-CN', command = false, runEffects = false, access = UNRESTRICTED_ACCESS, logPanel = { visible: false, modal: false } }) {
  const slots = [], events = [], saved = new Map()
  let cursor = 0, tree, pendingEffects = []
  const listeners = new Map()
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useMemo(fn) { return fn() },
    useEffect(fn, deps) {
      if (!runEffects) return
      const index = cursor++, previous = slots[index]
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        slots[index] = { deps, cleanup: previous?.cleanup }
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn() })
      }
    },
    useLayoutEffect() {},
    useSyncExternalStore(_subscribe, snapshot) { return snapshot() },
  }
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
  const oldWindow = globalThis.window, oldLocalStorage = globalThis.localStorage, oldDocument = globalThis.document
  globalThis.window = {
    localStorage: storage, matchMedia: () => ({ matches: mobile }), innerWidth: mobile ? 390 : 1440,
    addEventListener(type, listener) { const handlers = listeners.get(type) ?? new Set(); handlers.add(listener); listeners.set(type, handlers) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
  }
  globalThis.document = { body: { style: { overflow: '' } } }
  globalThis.localStorage = storage
  const i18n = { locale, t: (message, values) => translate(locale, message, values) }
  const mocks = {
    react: hooks,
    'react-router-dom': { Link: 'a', Outlet: 'outlet', useLocation: () => ({ pathname: path, search: '' }), useNavigate: () => value => events.push(value), matchPath },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../hooks/use-console-connected': { useConsoleConnected: () => true },
    '../utils/console-client': { app: { subscribe() {}, getRoutes: () => routes } },
    '../i18n': { useI18n: () => i18n }, '../i18n/locale.mjs': { translate }, '../i18n/navigation': navigation,
    '../navigation-taxonomy': taxonomy, '../navigation-location.mjs': { resolveNavigationLocation },
    '../components/sidebarMenuIcons': { getSidebarLucideIcon: () => 'icon' }, './sidebarMenuIcons': { getSidebarLucideIcon: () => 'icon' },
    '../components/LanguageSelect': { LanguageSelect: 'language-select' }, '../components/UserMenu': { UserMenu: 'user-menu' },
    '@zhin.js/console-ui': { cn: (...values) => values.filter(Boolean).join(' '), BrandMark: 'brand-mark', CONSOLE_PRODUCT_NAME: 'Zhin Console', ListItemButton: 'button', Button: 'button', buttonVariants: () => '', ScrollArea: 'scroll-area', ...(ui(['Tooltip', 'TooltipTrigger', 'TooltipContent'])), ...(ui(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuGroup', 'DropdownMenuItem', 'DropdownMenuLabel'])), ...(ui(['Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle'])), ...(ui(['Aurora', 'Chip', 'IconButton', 'NavIcon', 'NavPill', 'StatusDot', 'TabBar', 'TabBarItem'])) }, './command-center-model.mjs': commandCenterModel,
    '../utils/auth': { notifyAuthRequired() {}, apiFetch: async () => ({ ok: false, json: async () => null }) },
    '../contracts/zhin-console': { CONSOLE_REST: { INTROSPECTION: '/api/introspection' } }, '../components/ConsoleCommandCenter': { ConsoleCommandCenter: 'command-center' },
    '../navigation-sections.mjs': sections, '../hooks/use-console-access': { useConsoleAccess: () => access },
    '../utils/console-auth-api': { signOut() {} }, '../utils/console-auth-model.mjs': { principalLabel: () => '' },
    '../hooks/use-console-session': { useConsoleSession: () => ({ me: null }) },
    '../components/onboarding-banner': { OnboardingBanner: 'onboarding-banner' }, '../components/InstanceUnavailableBanner': { InstanceUnavailableBanner: 'instance-banner' }, '../pages/attention/AttentionBadge': { AttentionBadge: 'attention-badge' }, '../components/ConnectionIndicator': { ConnectionIndicator: 'connection-indicator' }, '../components/StatusState': { StatusState: 'status-state' }, '../console-routes.mjs': { LEGACY_ROUTE_REDIRECTS: {}, isPluginPageRedirect: () => false, CONSOLE_PATHS: { account: '/account' } },
    '../scope/scope-tree.mjs': scopeTree,
    '../components/log-panel/LogPanel': { LogPanel: 'log-panel', LogPanelButton: 'log-panel-button', useLogPanelLayout: () => logPanel },
    './log-panel/log-panel-store.mjs': logPanelStoreModule, './log-panel/log-panel-model.mjs': logPanelModel,
    '../plugin-pages.mjs': pluginPages,
  }
  mocks['../hooks/useIsMobile'] = compile(mobileHookSource, { react: hooks })
  const module = compile(command ? commandSource : layoutSource, mocks)
  return {
    events,
    render() {
      cursor = 0; tree = command ? module.ConsoleCommandCenter({ routes }) : module.default()
      const effects = pendingEffects; pendingEffects = []; effects.forEach(run => run())
      return tree
    },
    keyDown(event) { listeners.get('keydown')?.forEach(listener => listener(event)) },
    get tree() { return tree },
    close() {
      slots.forEach(slot => slot?.cleanup?.())
      globalThis.window = oldWindow; globalThis.localStorage = oldLocalStorage; globalThis.document = oldDocument
    },
  }
}
const routes = [
  { path: '/sandbox', name: '会话', meta: { group: '会话', order: 0 } },
  { path: '/scope', name: '账号与会话', meta: { group: '会话', order: 1 } },
  { path: '/scope/:adapter/:endpoint', name: '聊天账号详情', parent: '/scope', meta: { hideInMenu: true, group: '会话' } },
  { path: '/dashboard', name: '首页', meta: { group: '概览', order: 0 } },
  { path: '/logs', name: '运行日志', meta: { group: '概览', order: 1 } },
  { path: '/secret-diagnostic', name: 'Hidden diagnostic', meta: { group: '概览', hideInMenu: true } },
  { path: '/features', name: '功能矩阵', meta: { group: '功能', order: 0 } },
  { path: '/plugins', name: '插件', meta: { group: '插件', order: 0 } },
  { path: '/ops/config', name: '配置文件', meta: { group: '运维', order: 1 } },
  { path: '/ops/schedules', name: '定时任务', meta: { group: '运维', order: 3 } },
  { path: '/calendar', name: 'Calendar', meta: { group: 'My tools' } },
  { path: '/unclassified', name: 'Another plugin' },
  { path: '/backup', name: 'Backup', meta: { group: 'My tools', section: 'ops', order: 9 } },
]
const nav = (tree, label) => nodes(tree).find(node => node.type === 'nav' && node.props['aria-label'] === label)
const navLinks = tree => nodes(nav(tree, '主导航')).filter(node => node.type === 'a').map(node => node.props.to)
const sectionIds = tree => nodes(nav(tree, '主导航')).filter(node => node.props?.['data-section']).map(node => node.props['data-section'])
// The drawer prints the tier labels (日常 / 管理); the top bar is one flat row of sections.
const tierLabels = tree => nodes(nav(tree, '主导航')).filter(node => node.props?.className === 'console-nav-tier')
  .map(node => text(nodes(node).find(child => child.props?.className === 'console-nav-tier-label')))
/** The current section's pages: the Chips under the top bar (console-ui 1.3.0). */
const subnav = tree => nodes(tree).find(node => node.type === 'nav' && node.props?.className === 'console-section-nav')
const chipLinks = tree => nodes(subnav(tree)).filter(node => node.type === 'a').map(node => node.props.to)
const tabBar = tree => nodes(tree).find(node => node.type === 'TabBar')
const moreButton = tree => nodes(tabBar(tree)).find(node => node.type === 'button')
const ALL_PAGES = ['/dashboard', '/logs', '/sandbox', '/scope', '/features', '/calendar', '/unclassified', '/plugins', '/ops/config', '/ops/schedules', '/backup']

test('six sections in two tiers (日常 / 管理); plugin pages without a section land in 功能 and a declared section is honoured', () => {
  const f = fixture({ routes })
  try {
    const tree = f.render()
    // Top bar: one item per section, opening the section's first page.
    assert.deepEqual(sectionIds(tree), ['overview', 'sessions', 'features', 'plugins', 'ops'])
    assert.deepEqual(navLinks(tree), ['/dashboard', '/sandbox', '/features', '/plugins', '/ops/config'])
    assert.equal(nav(tree, '设置菜单'), undefined, 'settings no longer live in a footer menu')
    assert.equal(nodes(tree).find(node => node.props?.className === 'console-brand-link').props.to, '/')
  } finally { f.close() }
  for (const path of ['/features', '/ops/config']) {
    const f = fixture({ routes, path })
    try {
      // The section's pages, including plugin pages that land in it, are the Chips under the bar.
      assert.deepEqual(chipLinks(f.render()), path === '/features' ? ['/features', '/calendar', '/unclassified'] : ['/ops/config', '/ops/schedules', '/backup'])
    } finally { f.close() }
  }
  const drawer = fixture({ routes, mobile: true })
  try {
    const tree = drawer.render()
    assert.deepEqual(tierLabels(tree), ['日常', '管理'], 'the drawer keeps the two tiers')
    assert.deepEqual(navLinks(tree), ALL_PAGES)
  } finally { drawer.close() }
})

test('the current section is a NavPill with its name, the others round NavIcons with a label; its pages are Chips', () => {
  const f = fixture({ routes, path: '/ops/config' })
  try {
    const tree = f.render(), bar = nav(tree, '主导航')
    const items = nodes(bar).filter(node => node.props?.['data-section'])
    assert.deepEqual(items.map(node => node.type), ['NavIcon', 'NavIcon', 'NavIcon', 'NavIcon', 'NavPill'])
    const pill = items.find(node => node.type === 'NavPill')
    assert.equal(pill.props['data-section'], 'ops'); assert.equal(text(pill), '运维')
    for (const icon of items.filter(node => node.type === 'NavIcon')) assert.ok(icon.props.label, `${icon.props['data-section']} is named`)
    assert.ok(!nodes(bar).some(node => node.type === 'DropdownMenu'), 'no section menus any more')
    const chips = subnav(tree)
    assert.equal(chips.props['aria-label'], '运维的页面')
    assert.ok(nodes(chips).every(node => node.type !== 'a' || nodes(chips).some(chip => chip.type === 'Chip')))
    assert.equal(nodes(chips).find(node => node.type === 'a' && node.props.to === '/ops/config').props['aria-current'], 'page')
    assert.equal(nodes(chips).find(node => node.type === 'a' && node.props.to === '/backup').props['aria-current'], undefined)
  } finally { f.close() }
  // A section with one page has no sub-navigation.
  const plugins = fixture({ routes, path: '/plugins' })
  try { assert.equal(subnav(plugins.render()), undefined) } finally { plugins.close() }
})

test('a section with no visible page is hidden, and so is a tier left empty', () => {
  // 访问控制 has no pages yet, so it never appears even for an unrestricted session.
  const plain = fixture({ routes })
  try { assert.ok(!sectionIds(plain.render()).includes('access')) } finally { plain.close() }
  const viewer = fixture({ routes, access: createConsoleAccess({ permissions: ['status.view', 'endpoint.view', 'feature.view'] }) })
  try {
    const tree = viewer.render()
    assert.deepEqual(sectionIds(tree), ['overview', 'sessions', 'features'])
    assert.ok(!navLinks(tree).includes('/ops/config') && !navLinks(tree).includes('/plugins'))
  } finally { viewer.close() }
  const viewerDrawer = fixture({ routes, mobile: true, access: createConsoleAccess({ permissions: ['status.view', 'endpoint.view', 'feature.view'] }) })
  try { assert.deepEqual(tierLabels(viewerDrawer.render()), ['日常']) } finally { viewerDrawer.close() }
  const scheduler = fixture({ routes, path: '/ops/schedules', access: createConsoleAccess({ permissions: ['ops.schedule.read'] }) })
  try {
    const tree = scheduler.render()
    assert.deepEqual(sectionIds(tree), ['ops'])
    assert.deepEqual(navLinks(tree), ['/ops/schedules'])
    assert.deepEqual(chipLinks(tree), ['/ops/schedules', '/backup'], 'a plugin page in 运维 follows the section permission set')
  } finally { scheduler.close() }
})

test('a nested channel URL selects the account page and an 运维 route is selected in primary navigation', () => {
  const account = fixture({ routes, path: '/scope/qq/bot' })
  try {
    const tree = account.render()
    assert.equal(nodes(nav(tree, '主导航')).find(node => node.type === 'NavPill').props['data-section'], 'sessions')
    assert.equal(nodes(subnav(tree)).find(node => node.props?.['aria-current'] === 'page').props.to, '/scope')
  } finally { account.close() }
  for (const [path, section] of [['/logs', 'overview'], ['/ops/config', 'ops']]) {
    const f = fixture({ routes, path })
    try {
      const tree = f.render()
      assert.equal(nodes(nav(tree, '主导航')).find(node => node.type === 'NavPill').props['data-section'], section)
      assert.equal(nodes(subnav(tree)).find(node => node.props?.['aria-current'] === 'page').props.to, path)
    } finally { f.close() }
  }
})

test('every navigation item is named, and the closed drawer on phones cannot receive focus', () => {
  const wide = fixture({ routes })
  try {
    const tree = wide.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside'), undefined, 'wide screens have no drawer')
    assert.equal(tabBar(tree), undefined, 'nor a tab bar')
    for (const item of nodes(nav(tree, '主导航')).filter(node => node.props?.['data-section'])) assert.ok(item.type === 'NavIcon' ? item.props.label : text(item).trim(), `${item.props['data-section']} has a name`)
  } finally { wide.close() }
  const mobile = fixture({ routes, mobile: true })
  try {
    let tree = mobile.render()
    assert.equal(nav(tree, '主导航').props.className, 'console-drawer-nav', 'phones keep the sections out of the top bar')
    assert.deepEqual(nodes(tabBar(tree)).filter(node => node.type === 'TabBarItem' && node.props['data-section']).map(node => node.props['data-section']), ['overview', 'sessions', 'features', 'plugins'], 'the tab bar holds four sections')
    assert.equal(text(moreButton(tree)).trim().endsWith('更多'), true)
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, true)
    moreButton(tree).props.onClick()
    tree = mobile.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, false)
    assert.equal(moreButton(tree).props['aria-expanded'], true)
    assert.equal(nodes(tree).find(node => node.type === 'main').props.inert, true, 'the page behind the open drawer is inert')
    assert.equal(nodes(tree).find(node => node.type === 'header').props.inert, true, 'so is the top bar')
    nodes(nav(tree, '主导航')).find(node => node.type === 'a' && node.props.to === '/ops/config').props.onClick()
    assert.equal(nodes(mobile.render()).find(node => node.type === 'aside').props.inert, true)
  } finally { mobile.close() }
})

test('the tab bar marks 更多 as current when the page belongs to a section beyond the first four', () => {
  const f = fixture({ routes, mobile: true, path: '/ops/config' })
  try {
    const tree = f.render()
    assert.ok(!nodes(tabBar(tree)).some(node => node.type === 'TabBarItem' && node.props.current && node.props['data-section']))
    assert.equal(moreButton(tree).props['data-active'], 'true')
  } finally { f.close() }
})

test('legacy plugin groups that are not sections show under 功能', () => {
  const f = fixture({ routes: [...routes, { path: '/legacy', name: 'Legacy tools', meta: { group: '高级' } }], path: '/features' })
  try { assert.ok(chipLinks(f.render()).includes('/legacy')) } finally { f.close() }
})

test('breadcrumbs lead back to the menu page and explicit translated plugin titles are preserved', () => {
  const extra = [{ path: '/translated', name: '日历', meta: { group: '插件', titleI18n: { en: 'Team calendar' } } }, { path: '/ops/config/detail', name: '配置详情', parent: '/ops/config', meta: { hideInMenu: true, group: '运维' } }]
  const f = fixture({ routes: [...routes, ...extra], path: '/ops/config/detail', locale: 'en' })
  try {
    const tree = f.render(), breadcrumb = nav(tree, translate('en', '当前位置'))
    // Below a menu page: its parent, then the page; the section is already named by the Chips.
    assert.ok(text(breadcrumb).startsWith(translate('en', '配置文件')))
  } finally { f.close() }
  const menu = fixture({ routes: [...routes, ...extra], path: '/scope', locale: 'en' })
  try { assert.equal(nav(menu.render(), translate('en', '当前位置')), undefined, 'a menu page needs no breadcrumb: its Chip is current') } finally { menu.close() }
  const plugins = fixture({ routes: [...routes, ...extra], path: '/plugins', locale: 'en' })
  try { assert.ok(nodes(subnav(plugins.render())).some(node => node.type === 'a' && text(node) === 'Team calendar'), 'the translated title names its Chip') } finally { plugins.close() }
})

test('object pages below 全局 keep only their own scope breadcrumb; the top bar drops its one', () => {
  for (const path of ['/scope/qq', '/scope/qq/bot', '/scope/qq/bot/group%3A1']) {
    const f = fixture({ routes, path })
    try {
      const breadcrumbs = nodes(f.render()).filter(node => node.type === 'nav' && node.props?.['aria-label'] === '当前位置')
      assert.equal(breadcrumbs.length, 0, path)
    } finally { f.close() }
  }
})

test('command jumps follow currently registered routes and do not retain removed Host destinations', () => {
  const f = fixture({ routes, path: '/ops/schedules', command: true })
  try {
    const tree = f.render()
    assert.equal(nodes(tree).filter(node => node.type === 'button' && text(node).includes('与 Agent 对话并处理工作')).length, 1, 'the registered workspace appears once in command results')
    assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node).includes('配置 Workroom 关系')))
    const enter = nodes(tree).find(node => node.type === 'button' && text(node).includes('进入会话'))
    enter.props.onClick(); assert.deepEqual(f.events, ['/sandbox'])
  } finally { f.close() }
  const missing = fixture({ routes: routes.filter(route => route.path !== '/sandbox'), command: true })
  try { assert.ok(!text(missing.render()).includes('进入会话')) } finally { missing.close() }
})


const builtinShellSource = await source('registerBuiltinShell.tsx')
/** Builtin route records as registered by registerBuiltinShell.tsx (path, name, group, hidden). */
// Pages register `path: P.<key>`; the legacy redirect loop (`path, name: path`) is skipped here.
const builtinRoutes = builtinShellSource.split('app.addRoute(').slice(1).filter(chunk => /path: P\.\w+/.test(chunk)).map(chunk => {
  const group = chunk.match(/group: NAV_GROUPS\.(\w+)/)?.[1]
  return {
    path: CONSOLE_PATHS[chunk.match(/path: P\.(\w+)/)[1]],
    name: chunk.match(/name: '([^']+)'/)[1],
    meta: { group: group ? taxonomy.NAV_GROUPS[group] : undefined, ...(/hideInMenu: true/.test(chunk) ? { hideInMenu: true } : {}) },
  }
})
const paletteRoutes = [{ path: '/sandbox', name: '会话', meta: { group: '会话', order: 0 } }, ...builtinRoutes]
const paletteItemPaths = tree => nodes(tree).filter(node => node.type === 'button' && node.props.role === 'option').map(node => node.key)
function searchPalette(f, query) {
  f.render()
  nodes(f.tree).find(node => node.type === 'input').props.onChange({ target: { value: query } })
  return paletteItemPaths(f.render())
}

test('command palette lists hidden builtin pages without route parameters but skips detail and legacy redirect routes', () => {
  assert.ok(builtinRoutes.length > 20, 'the builtin route parser found the registered pages')
  const f = fixture({ routes: paletteRoutes, path: '/dashboard', command: true })
  try {
    const paths = paletteItemPaths(f.render())
    for (const path of ['/agent/replay', '/permissions', '/use-cases/group-welcome', '/features/ai/workrooms/catalog', '/features', '/ops/database']) assert.ok(paths.includes(path), `${path} is reachable from the palette`)
    for (const path of ['/plugins/:name', '/scope/:adapter/:endpoint', '/features/global/:plugin', '/scope/:adapter']) assert.ok(!paths.includes(path), `${path} needs parameters and stays out`)
    for (const path of ['/cron', '/assistant/jobs', '/tasks', '/config', '/agent/models']) assert.ok(!paths.includes(path), `${path} is a legacy redirect and stays out`)
    assert.equal(paths.length, new Set(paths).size, 'every destination appears once')
  } finally { f.close() }
})

test('command palette search matches each builtin page by purpose keywords, not only by title', () => {
  const f = fixture({ routes: paletteRoutes, path: '/dashboard', command: true })
  try {
    const expectations = {
      '插话': '/features/ai/ambient', '花费': '/agent/usage', '回归测试': '/scenario-lab', 'API Key': '/features/ai',
      '挑技能': '/features/ai/skills', '为什么没回': '/agent/replay', '权限': '/permissions', '定时': '/ops/schedules', '欢迎': '/use-cases/group-welcome',
      '功能矩阵': '/features', '适配器': '/scope', '会话': '/scope',
    }
    for (const [query, path] of Object.entries(expectations)) assert.ok(searchPalette(f, query).includes(path), `“${query}” finds ${path}`)
    assert.deepEqual(searchPalette(f, '完全无关的词'), [])
  } finally { f.close() }
  const english = fixture({ routes: paletteRoutes, path: '/dashboard', command: true, locale: 'en' })
  try {
    assert.ok(searchPalette(english, 'cost').includes('/agent/usage'), 'English keywords find the usage page')
    assert.ok(searchPalette(english, '插话').includes('/features/ai/ambient'), 'Chinese keywords still match in English')
  } finally { english.close() }
})

/**
 * Plugin pages as `loadConsoleEntries` registers them (ADR 0063 决策 3): the planned tab route, and for an
 * adapter page the hidden redirect at its old path, which `registerPluginPageRedirect` records. Lottery declares the
 * alias 抽奖 for 彩票推荐 (`definePage({ keywords })`), RSS still declares a section.
 */
function pluginPageRoutes() {
  const planned = [
    [{ path: '/lottery', name: '彩票推荐', meta: { titleI18n: { en: 'Lottery picks' } } }, { id: 'index', owner: 'root/lottery', route: '/lottery', meta: { keywords: { 'zh-CN': ['抽奖'], en: ['raffle'] } } }],
    [{ path: '/rss', name: 'RSS 订阅', meta: { section: 'ops' } }, { id: 'index', owner: 'root/rss', route: '/rss', section: 'ops' }],
    [{ path: '/icqq', name: 'ICQQ' }, { id: 'index', owner: 'root/adapter-icqq', route: '/icqq', blueprint: { kind: 'zhin.console.adapter-page', adapterKey: 'icqq' } }],
    [{ path: '/sandbox', name: '会话' }, { id: 'index', owner: 'root/sandbox', route: '/sandbox' }],
  ].map(([route, entry]) => taxonomy.planPluginRoute(route, pluginPages.describePluginPage(entry)))
  const out = []
  for (const plan of planned) {
    if (plan.page) out.push(plan.page)
    if (plan.redirect) { registerPluginPageRedirect(plan.redirect.path, plan.redirectTo); out.push(plan.redirect) }
  }
  return out
}

test('plugin pages are not in the top bar: 功能 lists only Console pages, the Sandbox stays in 会话', () => {
  const plugins = pluginPageRoutes()
  const f = fixture({ routes: [...routes.filter(route => !['/calendar', '/unclassified', '/backup', '/sandbox'].includes(route.path)), ...plugins], path: '/dashboard' })
  try {
    const links = navLinks(f.render())
    for (const path of ['/lottery', '/plugins/lottery/index', '/rss', '/plugins/rss/index', '/icqq', '/scope/icqq']) assert.ok(!links.includes(path), `${path} is not a menu item`)
    assert.ok(links.includes('/sandbox'), 'the Sandbox keeps its 会话 entry')
    const tree = sections.buildNavigation([...routes.filter(route => route.path === '/features'), ...plugins])
    const features = tree.flatMap(tier => tier.sections).find(section => section.id === 'features')
    assert.deepEqual(features.routes.map(route => route.path), ['/features'], '功能 holds Console pages only, even for a page that declared a section')
    assert.ok(!tree.flatMap(tier => tier.sections).some(section => section.id === 'ops'), 'a declared section no longer opens a section')
  } finally { f.close(); clearPluginPageRedirects() }
})

test('the command palette finds plugin pages by alias, plugin, package and description, grouped under 插件, once each', () => {
  const plugins = pluginPageRoutes()
  pluginPages.setPluginDirectory(pluginPages.readPluginDirectory({ data: [{ name: 'lottery', instanceKey: 'lottery', packageName: '@zhin.js/plugin-lottery', description: '按规则推荐号码' }] }))
  const f = fixture({ routes: [...paletteRoutes.filter(route => route.path !== '/sandbox'), ...plugins], path: '/dashboard', command: true })
  try {
    const paths = paletteItemPaths(f.render())
    assert.ok(paths.includes('/plugins/lottery/index') && paths.includes('/plugins/rss/index'), 'plugin pages open at their tab')
    assert.ok(paths.includes('/scope/icqq'), 'the adapter page opens its adapter object page')
    for (const path of ['/lottery', '/rss', '/icqq']) assert.ok(!paths.includes(path), `${path} is not listed`)
    assert.equal(paths.length, new Set(paths).size, 'every destination appears once')
    const group = nodes(f.tree).find(node => node.type === 'section' && node.props['aria-label'] === '插件')
    assert.ok(nodes(group).some(node => node.key === '/plugins/lottery/index'), 'plugin pages are grouped under 插件')
    for (const query of ['抽奖', 'raffle', 'lottery', '@zhin.js/plugin-lottery', '推荐号码', '彩票推荐']) assert.deepEqual(searchPalette(f, query).filter(path => path.startsWith('/plugins/lottery')), ['/plugins/lottery/index'], `“${query}” finds 彩票推荐`)
    assert.ok(searchPalette(f, 'rss').includes('/plugins/rss/index'))
    assert.ok(searchPalette(f, 'icqq').includes('/scope/icqq'))
    searchPalette(f, 'lottery')
    assert.ok(text(f.tree).includes('lottery · 按规则推荐号码'), 'the description names the plugin')
  } finally { f.close() }
  const english = fixture({ routes: plugins, path: '/dashboard', command: true, locale: 'en' })
  try {
    assert.ok(searchPalette(english, '抽奖').includes('/plugins/lottery/index'), 'aliases of every language match in English')
    assert.ok(searchPalette(english, 'Lottery picks').includes('/plugins/lottery/index'), 'the translated title matches')
  } finally { english.close(); clearPluginPageRedirects(); pluginPages.setPluginDirectory(null) }
})

test('mobile Escape leaves a top-level Radix dismissal consumed before closing the drawer on the next Escape', () => {
  const f = fixture({ routes, mobile: true, runEffects: true })
  try {
    let tree = f.render()
    moreButton(tree).props.onClick()
    assert.equal(nodes(f.render()).find(node => node.type === 'aside').props.inert, false)
    // Radix's document-capture DismissableLayer consumes this same event before window bubbling.
    const menuEscape = new Event('keydown', { cancelable: true })
    Object.defineProperty(menuEscape, 'key', { value: 'Escape' })
    menuEscape.preventDefault()
    f.keyDown(menuEscape)
    assert.equal(nodes(f.render()).find(node => node.type === 'aside').props.inert, false, 'dismissing the menu leaves its drawer and trigger available')
    const drawerEscape = new Event('keydown', { cancelable: true })
    Object.defineProperty(drawerEscape, 'key', { value: 'Escape' })
    f.keyDown(drawerEscape)
    assert.equal(nodes(f.render()).find(node => node.type === 'aside').props.inert, true)
    assert.equal(globalThis.document.body.style.overflow, '', 'closing restores document scrolling')
  } finally { f.close() }
})


test('a section whose only page carries the section name omits its repeated heading', () => {
  const f = fixture({ routes: routes.filter(route => route.path !== '/scope'), mobile: true })
  try {
    const primary = nav(f.render(), '主导航')
    assert.ok(nodes(primary).some(node => node.type === 'a' && node.props.to === '/sandbox'))
    const headings = nodes(primary).filter(node => node.props?.className === 'console-nav-group-label').map(text)
    assert.ok(!headings.includes('会话'))
    assert.ok(headings.includes('概览'), 'a distinct section heading remains when no destination carries its name')
  } finally { f.close() }
})

test('the command palette hides pages the principal cannot see and groups results by section', () => {
  const f = fixture({ routes, path: '/dashboard', command: true, access: createConsoleAccess({ permissions: ['status.view'] }) })
  try {
    const paths = paletteItemPaths(f.render())
    assert.ok(paths.includes('/logs'))
    assert.ok(!paths.includes('/ops/config') && !paths.includes('/plugins'), 'pages outside the granted sections stay out')
  } finally { f.close() }
})

test('the bottom log panel is non-modal on wide screens: the shell keeps the page interactive, only the phone sheet makes it inert', () => {
  const inertOf = tree => ({
    main: nodes(tree).find(node => node.type === 'main').props.inert,
    header: nodes(tree).find(node => node.type === 'header').props.inert,
  })
  const closed = fixture({ routes, path: '/dashboard' })
  try {
    const tree = closed.render()
    assert.equal(nodes(tree).filter(node => node.type === 'log-panel').length, 1, 'mounted once in the shell')
    const actions = nodes(tree).find(node => node.props?.className === 'console-topnav-actions')
    assert.ok(nodes(actions).some(node => node.type === 'log-panel-button'), 'the toggle sits with the top-bar actions')
    assert.deepEqual(inertOf(tree), { main: false, header: false })
  } finally { closed.close() }
  const docked = fixture({ routes, path: '/dashboard', logPanel: { visible: true, modal: false } })
  try {
    const tree = docked.render()
    assert.deepEqual(inertOf(tree), { main: false, header: false }, 'no inert while the docked panel is open')
    assert.ok(!nodes(tree).some(node => typeof node.props?.className === 'string' && /scrim/.test(node.props.className) && node.props.className.includes('is-open')), 'no backdrop')
  } finally { docked.close() }
  const sheet = fixture({ routes, path: '/dashboard', mobile: true, logPanel: { visible: true, modal: true } })
  try { assert.deepEqual(inertOf(sheet.render()), { main: true, header: true }, 'the phone sheet is modal') } finally { sheet.close() }
})

test('command center offers 打开日志面板 with its shortcut, runs it in place and hides it from principals who cannot see /logs', () => {
  const oldFrame = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = callback => { callback(); return 1 }
  logPanelStoreModule.closeLogPanel()
  const f = fixture({ routes, path: '/ops/schedules', command: true })
  try {
    const tree = f.render()
    const item = nodes(tree).find(node => node.type === 'button' && node.props.role === 'option' && text(node).includes('打开日志面板'))
    assert.ok(item, 'listed as a quick action')
    assert.ok(nodes(item).some(node => node.type === 'kbd' && text(node) === logPanelModel.LOG_PANEL_SHORTCUT_LABEL), 'shows Ctrl `')
    const footer = nodes(tree).find(node => node.type === 'footer')
    assert.match(text(footer), /Ctrl `日志面板/, 'the footer documents the shortcut')
    item.props.onClick()
    assert.equal(logPanelStoreModule.logPanelStore.get().open, true, 'opens the panel')
    assert.deepEqual(f.events, [], 'and does not navigate')
  } finally { f.close(); logPanelStoreModule.closeLogPanel(); globalThis.requestAnimationFrame = oldFrame }
  const noStatus = fixture({ routes, command: true, access: createConsoleAccess({ permissions: ['ops.schedule.read'] }) })
  try {
    const tree = noStatus.render()
    assert.ok(!text(tree).includes('打开日志面板'))
    assert.ok(!text(nodes(tree).find(node => node.type === 'footer')).includes('日志面板'))
  } finally { noStatus.close() }
  const noLogsRoute = fixture({ routes: routes.filter(route => route.path !== '/logs'), command: true })
  try { assert.ok(!text(noLogsRoute.render()).includes('打开日志面板')) } finally { noLogsRoute.close() }
})

test('the command palette finds installed plugins without a page of their own, only once a query is typed', () => {
  pluginPages.setPluginDirectory(pluginPages.readPluginDirectory({ data: [
    { name: 'weather', instanceKey: 'weather', packageName: '@zhin.js/plugin-weather', description: '查询城市天气' },
    { name: 'sign-in', instanceKey: 'sign-in', description: '每日签到与积分' },
  ] }))
  const f = fixture({ routes: paletteRoutes, path: '/dashboard', command: true })
  try {
    const idle = paletteItemPaths(f.render())
    assert.ok(!idle.some(path => path === '/plugins/weather' || path === '/plugins/sign-in'), 'the idle palette does not list every plugin')
    assert.ok(searchPalette(f, 'weather').includes('/plugins/weather'), '“weather” finds the plugin')
    assert.ok(searchPalette(f, '天气').includes('/plugins/weather'), 'the description matches')
    assert.ok(searchPalette(f, '签到').includes('/plugins/sign-in'), '“签到” finds the sign-in plugin')
  } finally { f.close(); pluginPages.setPluginDirectory(null) }
})
