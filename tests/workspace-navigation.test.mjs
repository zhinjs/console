import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { matchPath } from 'react-router-dom'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { resolveNavigationLocation } from '../console-ui/src/navigation-location.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return module.exports
}
const taxonomy = compile(await source('navigation-taxonomy.ts'), {})
const navigation = compile(await source('i18n/navigation.ts'), { './locale.mjs': { translate } })
const layoutSource = await source('layouts/dashboard.tsx')
const commandSource = await source('components/ConsoleCommandCenter.tsx')
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ui = names => Object.fromEntries(names.map(name => [name, name]))
function fixture({ routes, path = '/sandbox', mobile = false, collapsed = false, locale = 'zh-CN', command = false, runEffects = false }) {
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
    '@zhin.js/client': { app: { subscribe() {}, _getRoutes: () => routes }, cn: (...values) => values.filter(Boolean).join(' '), useWebSocket: () => ({ connected: true }) },
    '../i18n': { useI18n: () => i18n }, '../i18n/locale.mjs': { translate }, '../i18n/navigation': navigation,
    '../navigation-taxonomy': taxonomy, '../navigation-location.mjs': { resolveNavigationLocation },
    '../components/sidebarMenuIcons': { getSidebarLucideIcon: () => 'icon' }, './sidebarMenuIcons': { getSidebarLucideIcon: () => 'icon' },
    '../components/LanguageSelect': { LanguageSelect: 'language-select' }, '../components/ThemeToggle': { ThemeToggle: 'theme-toggle' },
    '../components/ui/button': { Button: 'button', buttonVariants: () => '' }, '../components/ui/scroll-area': { ScrollArea: 'scroll-area' },
    '../components/ui/tooltip': ui(['Tooltip', 'TooltipTrigger', 'TooltipContent']),
    '../components/ui/dropdown-menu': ui(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel']),
    './ui/dialog': ui(['Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle']),
    '../utils/auth': { notifyAuthRequired() {} }, '../utils/demo-mode': { isDemoMode: () => false },
    '../components/DemoOnboarding': { reopenDemoOnboarding() {} }, '../components/ConsoleCommandCenter': { ConsoleCommandCenter: 'command-center' },
  }
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
  { path: '/endpoints', name: '聊天账号', meta: { group: '聊天账号' } },
  { path: '/endpoints/:adapter/:endpointId', name: '渠道详情', parent: '/endpoints', meta: { hideInMenu: true } },
  { path: '/tasks', name: '任务中心', meta: { group: '任务' } },
  { path: '/config', name: '设置', meta: { group: '设置' } },
  { path: '/logs', name: '运行记录', meta: { group: '运行维护' } },
  { path: '/secret-diagnostic', name: 'Hidden diagnostic', meta: { group: '运行维护', hideInMenu: true } },
  { path: '/calendar', name: 'Calendar', meta: { group: 'My tools' } },
  { path: '/unclassified', name: 'Another plugin' },
]
const nav = (tree, label) => nodes(tree).find(node => node.type === 'nav' && node.props['aria-label'] === label)

test('working navigation separates management menus without dropping dynamic or ungrouped plugin routes', () => {
  const f = fixture({ routes })
  try {
    const tree = f.render(), primary = nav(tree, '主导航'), secondary = nav(tree, '设置与运行维护')
    assert.deepEqual(nodes(primary).filter(node => node.type === 'a').map(node => node.props.to), ['/sandbox', '/tasks', '/endpoints', '/unclassified', '/calendar'])
    assert.deepEqual(nodes(secondary).filter(node => node.type === 'DropdownMenu').map(node => text(nodes(node).find(child => child.type === 'DropdownMenuTrigger'))), ['设置', '运行维护'])
    assert.deepEqual(nodes(secondary).filter(node => node.type === 'a').map(node => node.props.to), ['/config', '/logs'])
    assert.equal(nodes(primary).filter(node => node.props?.className === 'console-nav-group-label').some(node => text(node) === '聊天账号'), false)
    assert.equal(nodes(tree).find(node => node.props?.className === 'console-sidebar-brand').props.to, '/')
  } finally { f.close() }
})

test('a nested channel URL selects the account menu while management routes select their footer group', () => {
  const account = fixture({ routes, path: '/endpoints/qq/bot' })
  try { assert.equal(nodes(nav(account.render(), '主导航')).find(node => node.props?.['aria-current'] === 'page').props.to, '/endpoints') } finally { account.close() }
  const management = fixture({ routes, path: '/logs' })
  try {
    const secondary = nav(management.render(), '设置与运行维护')
    const selected = nodes(secondary).find(node => node.type === 'button' && node.props.className.includes('is-active'))
    assert.equal(selected.props['aria-label'], '运行维护')
    assert.equal(nodes(secondary).find(node => node.props?.['aria-current'] === 'page').props.to, '/logs')
  } finally { management.close() }
})

test('collapsed navigation retains named controls and mobile hidden navigation cannot receive focus', () => {
  const compact = fixture({ routes, collapsed: true })
  try {
    const tree = compact.render(), secondary = nav(tree, '设置与运行维护')
    assert.deepEqual(nodes(secondary).filter(node => node.type === 'button').map(node => node.props['aria-label']), ['设置', '运行维护'])
    assert.equal(nodes(nav(tree, '主导航')).find(node => node.type === 'a' && node.props.to === '/calendar').props['aria-label'], 'Calendar')
  } finally { compact.close() }
  const mobile = fixture({ routes, mobile: true })
  try {
    let tree = mobile.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, true)
    nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '打开菜单').props.onClick()
    tree = mobile.render()
    assert.equal(nodes(tree).find(node => node.type === 'aside').props.inert, false)
    nodes(nav(tree, '设置与运行维护')).find(node => node.type === 'a').props.onClick()
    assert.equal(nodes(mobile.render()).find(node => node.type === 'aside').props.inert, true)
  } finally { mobile.close() }
})

test('explicit legacy Advanced plugin groups retain their collapsed preference', () => {
  const f = fixture({ routes: [...routes, { path: '/legacy', name: 'Legacy tools', meta: { group: '高级' } }] })
  try {
    let primary = nav(f.render(), '主导航')
    assert.ok(!nodes(primary).some(node => node.type === 'a' && node.props.to === '/legacy'))
    nodes(primary).find(node => node.type === 'button' && text(node) === '高级').props.onClick()
    primary = nav(f.render(), '主导航')
    assert.ok(nodes(primary).some(node => node.type === 'a' && node.props.to === '/legacy'))
  } finally { f.close() }
})

test('breadcrumbs omit repeated group names and explicit translated plugin titles are preserved', () => {
  const f = fixture({ routes: [...routes, { path: '/translated', name: '日历', meta: { group: '插件', titleI18n: { en: 'Team calendar' } } }], path: '/endpoints', locale: 'en' })
  try {
    const tree = f.render(), breadcrumb = nav(tree, translate('en', '当前位置'))
    assert.equal(text(breadcrumb), 'Chat accounts')
    assert.ok(nodes(nav(tree, translate('en', '主导航'))).some(node => node.type === 'a' && text(node) === 'Team calendar'))
  } finally { f.close() }
})

test('command jumps follow currently registered routes and do not retain removed Host destinations', () => {
  const f = fixture({ routes, path: '/tasks', command: true })
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


test('a primary group with a same-named destination omits its repeated heading while retaining every destination', () => {
  const f = fixture({ routes: [...routes, { path: '/agent/sessions', name: '聊天记录', meta: { group: '会话', order: 1 } }] })
  try {
    const primary = nav(f.render(), '主导航')
    assert.deepEqual(nodes(primary).filter(node => node.type === 'a').map(node => node.props.to), ['/sandbox', '/agent/sessions', '/tasks', '/endpoints', '/unclassified', '/calendar'])
    const headings = nodes(primary).filter(node => node.props?.className === 'console-nav-group-label').map(text)
    assert.ok(!headings.includes('会话'))
    assert.ok(headings.includes('任务'), 'a distinct group heading remains when no destination carries its name')
  } finally { f.close() }
})
