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
import { CONSOLE_PATHS } from '../console-ui/src/console-routes.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return module.exports
}
const taxonomy = compile(await source('navigation-taxonomy.ts'), { './navigation-sections.mjs': sections })
const navigation = compile(await source('i18n/navigation.ts'), { './locale.mjs': { translate } })
const layoutSource = await source('layouts/dashboard.tsx')
const mobileHookSource = await source('hooks/useIsMobile.ts')
const commandSource = await source('components/ConsoleCommandCenter.tsx')
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ui = names => Object.fromEntries(names.map(name => [name, name]))
function fixture({ routes, path = '/sandbox', mobile = false, collapsed = false, locale = 'zh-CN', command = false, runEffects = false, access = UNRESTRICTED_ACCESS }) {
  const slots = [], events = [], saved = new Map(collapsed ? [['zhin.console.nav.collapsed', '1']] : [])
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
    '../components/LanguageSelect': { LanguageSelect: 'language-select' }, '../components/ThemeToggle': { ThemeToggle: 'theme-toggle' },
    '../components/ui/list-item-button': { ListItemButton: 'button' }, '../components/ui/button': { Button: 'button', buttonVariants: () => '' }, '../components/ui/scroll-area': { ScrollArea: 'scroll-area' },
    '../components/ui/tooltip': ui(['Tooltip', 'TooltipTrigger', 'TooltipContent']),
    '../components/ui/dropdown-menu': ui(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel']),
    './ui/dialog': ui(['Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle']), './command-center-model.mjs': commandCenterModel,
    '../utils/auth': { notifyAuthRequired() {} }, '../components/ConsoleCommandCenter': { ConsoleCommandCenter: 'command-center' },
    '../navigation-sections.mjs': sections, '../hooks/use-console-access': { useConsoleAccess: () => access },
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
  { path: '/endpoints', name: '聊天账号', meta: { group: '会话', order: 1 } },
  { path: '/endpoints/:adapter/:endpointId', name: '聊天账号详情', parent: '/endpoints', meta: { hideInMenu: true, group: '会话' } },
  { path: '/dashboard', name: '首页', meta: { group: '概览', order: 0 } },
  { path: '/logs', name: '运行日志', meta: { group: '概览', order: 1 } },
  { path: '/secret-diagnostic', name: 'Hidden diagnostic', meta: { group: '概览', hideInMenu: true } },
  { path: '/features', name: '功能矩阵', meta: { group: '功能', order: 0 } },
  { path: '/plugins', name: '插件管理', meta: { group: '插件', order: 0 } },
  { path: '/ops/config', name: '配置文件', meta: { group: '运维', order: 1 } },
  { path: '/ops/schedules', name: '定时任务', meta: { group: '运维', order: 3 } },
  { path: '/calendar', name: 'Calendar', meta: { group: 'My tools' } },
  { path: '/unclassified', name: 'Another plugin' },
  { path: '/backup', name: 'Backup', meta: { group: 'My tools', section: 'ops', order: 9 } },
]
const navLinks = tree => nodes(nav(tree, '主导航')).filter(node => node.type === 'a').map(node => node.props.to)
const sectionIds = tree => nodes(nav(tree, '主导航')).filter(node => node.props?.['data-section']).map(node => node.props['data-section'])
const tierLabels = tree => nodes(nav(tree, '主导航')).filter(node => node.props?.className === 'console-nav-tier-label').map(text)
const nav = (tree, label) => nodes(tree).find(node => node.type === 'nav' && node.props['aria-label'] === label)

test('six sections in two tiers (日常 / 管理); plugin pages without a section land in 功能 and a declared section is honoured', () => {
  const f = fixture({ routes })
  try {
    const tree = f.render()
    assert.deepEqual(tierLabels(tree), ['日常', '管理'])
    assert.deepEqual(sectionIds(tree), ['overview', 'sessions', 'features', 'plugins', 'ops'])
    assert.deepEqual(navLinks(tree), ['/dashboard', '/logs', '/sandbox', '/endpoints', '/features', '/calendar', '/unclassified', '/plugins', '/ops/config', '/ops/schedules', '/backup'])
    assert.equal(nav(tree, '设置菜单'), undefined, 'settings no longer live in a footer menu')
    assert.equal(nodes(tree).find(node => node.props?.className === 'console-sidebar-brand').props.to, '/')
  } finally { f.close() }
})

test('a section with no visible page is hidden, and so is a tier left empty', () => {
  // 访问控制 has no pages yet, so it never appears even for an unrestricted session.
  const plain = fixture({ routes })
  try { assert.ok(!sectionIds(plain.render()).includes('access')) } finally { plain.close() }
  const viewer = fixture({ routes, access: createConsoleAccess({ permissions: ['status.view', 'endpoint.view', 'feature.view'] }) })
  try {
    const tree = viewer.render()
    assert.deepEqual(sectionIds(tree), ['overview', 'sessions', 'features'])
    assert.deepEqual(tierLabels(tree), ['日常'])
    assert.ok(!navLinks(tree).includes('/ops/config') && !navLinks(tree).includes('/plugins'))
  } finally { viewer.close() }
  const scheduler = fixture({ routes, access: createConsoleAccess({ permissions: ['ops.schedule.read'] }) })
  try {
    const tree = scheduler.render()
    assert.deepEqual(sectionIds(tree), ['ops'])
    assert.deepEqual(navLinks(tree), ['/ops/schedules', '/backup'], 'a plugin page in 运维 follows the section permission set')
  } finally { scheduler.close() }
})

test('a nested channel URL selects the account menu and an 运维 route is selected in primary navigation', () => {
  const account = fixture({ routes, path: '/endpoints/qq/bot' })
  try { assert.equal(nodes(nav(account.render(), '主导航')).find(node => node.props?.['aria-current'] === 'page').props.to, '/endpoints') } finally { account.close() }
  for (const path of ['/logs', '/ops/config']) {
    const f = fixture({ routes, path })
    try { assert.equal(nodes(nav(f.render(), '主导航')).find(node => node.props?.['aria-current'] === 'page').props.to, path) } finally { f.close() }
  }
})

test('collapsed navigation retains named controls and mobile hidden navigation cannot receive focus', () => {
  const compact = fixture({ routes, collapsed: true })
  try {
    const tree = compact.render()
    assert.deepEqual(tierLabels(tree), [], 'tier labels are hidden in the icon rail')
    assert.equal(nodes(nav(tree, '主导航')).find(node => node.type === 'a' && node.props.to === '/calendar').props['aria-label'], 'Calendar')
  } finally { compact.close() }
  const mobile = fixture({ routes, mobile: true })
  try {
    let tree = mobile.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, true)
    nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '打开菜单').props.onClick()
    tree = mobile.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, false)
    assert.equal(nodes(tree).find(node => node.props?.className === 'flex flex-col flex-1 overflow-hidden min-w-0 w-full').props.inert, true)
    nodes(nav(tree, '主导航')).find(node => node.type === 'a' && node.props.to === '/ops/config').props.onClick()
    assert.equal(nodes(mobile.render()).find(node => node.type === 'aside').props.inert, true)
  } finally { mobile.close() }
})

test('legacy plugin groups that are not sections show under 功能', () => {
  const f = fixture({ routes: [...routes, { path: '/legacy', name: 'Legacy tools', meta: { group: '高级' } }] })
  try {
    const tree = f.render()
    const features = nodes(nav(tree, '主导航')).find(node => node.props?.['data-section'] === 'features')
    assert.ok(nodes(features).some(node => node.type === 'a' && node.props.to === '/legacy'))
  } finally { f.close() }
})

test('breadcrumbs omit repeated group names and explicit translated plugin titles are preserved', () => {
  const f = fixture({ routes: [...routes, { path: '/translated', name: '日历', meta: { group: '插件', titleI18n: { en: 'Team calendar' } } }], path: '/endpoints', locale: 'en' })
  try {
    const tree = f.render(), breadcrumb = nav(tree, translate('en', '当前位置'))
    // The breadcrumb leads with the page's section (会话), then the page.
    assert.equal(text(breadcrumb), `${translate('en', '会话')}Chat accounts`)
    assert.ok(nodes(nav(tree, translate('en', '主导航'))).some(node => node.type === 'a' && text(node) === 'Team calendar'))
  } finally { f.close() }
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
    for (const path of ['/plugins/:name', '/endpoints/:adapter/:endpointId', '/features/global/:plugin', '/features/adapters/:adapter']) assert.ok(!paths.includes(path), `${path} needs parameters and stays out`)
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
      '功能矩阵': '/features', '适配器': '/features/adapters',
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

test('mobile Escape leaves a top-level Radix dismissal consumed before closing the drawer on the next Escape', () => {
  const f = fixture({ routes, mobile: true, runEffects: true })
  try {
    let tree = f.render()
    nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '打开菜单').props.onClick()
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
  const f = fixture({ routes: routes.filter(route => route.path !== '/endpoints') })
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
