import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as historyModel from '../console-ui/src/pages/logs/history-model.mjs'
import * as readState from '../console-ui/src/pages/logs/read-state.mjs'
import * as scopeFilter from '../console-ui/src/pages/insights/scope-filter.mjs'
import * as readError from '../console-ui/src/utils/read-error.mjs'
import * as model from '../console-ui/src/components/log-panel/log-panel-model.mjs'
import * as storeModule from '../console-ui/src/components/log-panel/log-panel-store.mjs'
import * as loginFlowModel from '../console-ui/src/pages/scope/login-flow-model.mjs'
import { createConsoleAccess, UNRESTRICTED_ACCESS } from '../console-ui/src/utils/console-access.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name.endsWith('.css')) return {}
    if (name === 'react/jsx-runtime') return require(name)
    throw new Error(`unmocked import ${name}`)
  }, module, module.exports)
  return module.exports
}
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const i18n = { locale: 'zh-CN', t: (message, values) => translate('zh-CN', message, values) }
const lucide = new Proxy({}, { get: (_target, key) => String(key) })

/** Minimal hook runtime: state, refs, memo, and (layout) effects that run after each render. */
function hookRuntime() {
  const slots = []
  let cursor = 0, pending = []
  const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const effect = (fn, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || !deps || !equal(previous.deps, deps)) {
      slots[index] = { deps, cleanup: previous?.cleanup }
      pending.push(() => { previous?.cleanup?.(); const cleanup = fn(); slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined })
    }
  }
  return {
    hooks: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
      useMemo(fn) { cursor++; return fn() },
      useCallback(fn) { cursor++; return fn },
      useEffect: effect,
      useLayoutEffect: effect,
      useSyncExternalStore(_subscribe, snapshot) { return snapshot() },
    },
    render(fn) { cursor = 0; const tree = fn(); const run = pending; pending = []; run.forEach(item => item()); return tree },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

function browser({ pathname = '/scope/qq/bot-1', innerHeight = 900 } = {}) {
  const listeners = new Map(), saved = new Map(), styleProps = new Map()
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) }
  const old = { window: globalThis.window, document: globalThis.document }
  const body = { style: { overflow: '' }, isConnected: true }
  globalThis.document = {
    body, activeElement: body,
    documentElement: { style: { setProperty: (name, value) => styleProps.set(name, value), removeProperty: name => styleProps.delete(name) } },
  }
  globalThis.window = {
    localStorage: storage, innerHeight, location: { pathname },
    addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
  }
  return {
    saved, styleProps, listeners,
    keyDown(event) {
      const full = { defaultPrevented: false, preventDefault() { full.defaultPrevented = true }, ...event }
      listeners.get('keydown')?.forEach(listener => listener(full))
      return full
    },
    restore() { globalThis.window = old.window; globalThis.document = old.document },
  }
}

// ---------- Pure model and store ----------

test('openLogPanel filters become the panel’s own params; the store never touches the location', async () => {
  assert.equal(model.logFilterParams({ q: ' boom ', adapter: 'qq', endpoint: 'bot-1', level: 'error' }).toString(), 'q=boom&adapter=qq&endpoint=bot-1&level=error')
  assert.equal(model.logFilterParams({ endpoint: 'bot-1' }).toString(), '', 'an account needs its adapter (same rule as readScopeFilter)')
  assert.equal(model.logFilterParams({ level: 'loud' }).toString(), '', 'unknown levels are dropped')
  assert.equal(model.sanitizeLogParams('tab=chat&q=a&page=2&evil=1').toString(), 'q=a&page=2')
  assert.equal(model.logPageHref('q=a b&adapter=qq&page=3'), '/logs?q=a+b&adapter=qq', '在日志页打开 starts at the first page with the same filter')
  assert.equal(model.logPageHref(''), '/logs')

  const store = storeModule.createLogPanelStore({ params: 'q=old', height: 400 })
  store.open()
  assert.equal(store.get().params, 'q=old', 'opening without a filter keeps the last one')
  const revision = store.get().revision
  store.open({ adapter: 'telegram', endpoint: 'preview-support' })
  assert.deepEqual({ ...store.get() }, { open: true, params: 'adapter=telegram&endpoint=preview-support', height: 400, revision: revision + 1 })
  store.toggle(); assert.equal(store.get().open, false)
  store.toggle(); assert.equal(store.get().open, true)
  store.setParams(new URLSearchParams('q=x&tab=records')); assert.equal(store.get().params, 'q=x')
  store.setHeight(5000, 1000); assert.equal(store.get().height, 800)
  for (const path of ['components/log-panel/log-panel-store.mjs', 'components/log-panel/log-panel-model.mjs', 'components/log-panel/LogPanel.tsx']) {
    assert.doesNotMatch(await source(path), /useSearchParams|useNavigate|history\.(push|replace)State|location\.(assign|replace|href\s*=)/, path)
  }
})

test('panel height: 180px to 80% of the viewport, drag from the top edge, keyboard steps', () => {
  assert.equal(model.clampPanelHeight(50, 900), 180)
  assert.equal(model.clampPanelHeight(2000, 900), 720)
  assert.equal(model.clampPanelHeight(400, 200), 180, 'a very short viewport still keeps the minimum')
  assert.equal(model.panelHeightForDrag(360, 600, 500, 900), 460, 'dragging up makes it taller')
  assert.equal(model.panelHeightForKey('ArrowUp', 360, 900), 384)
  assert.equal(model.panelHeightForKey('ArrowDown', 360, 900, true), 264)
  assert.equal(model.panelHeightForKey('Home', 360, 900), 180)
  assert.equal(model.panelHeightForKey('End', 360, 900), 720)
  assert.equal(model.panelHeightForKey('a', 360, 900), null)
})

test('Ctrl + ` is the shortcut; ⌘K / Ctrl+K and other chords are left alone', () => {
  assert.equal(model.LOG_PANEL_SHORTCUT_LABEL, 'Ctrl `')
  assert.ok(model.isLogPanelShortcut({ ctrlKey: true, code: 'Backquote', key: '`' }))
  assert.ok(!model.isLogPanelShortcut({ ctrlKey: true, code: 'KeyK', key: 'k' }))
  assert.ok(!model.isLogPanelShortcut({ metaKey: true, code: 'Backquote', key: '`' }), '⌘` switches windows on macOS')
  assert.ok(!model.isLogPanelShortcut({ ctrlKey: true, shiftKey: true, code: 'Backquote', key: '~' }))
  assert.ok(!model.isLogPanelShortcut({ code: 'Backquote', key: '`' }), 'a bare backtick is typing')
  assert.ok(!model.isLogPanelShortcut({ ctrlKey: true, code: 'Backquote', isComposing: true }))
  assert.ok(model.shouldCloseOnEscape({ key: 'Escape', defaultPrevented: false, focusInside: true }))
  assert.ok(!model.shouldCloseOnEscape({ key: 'Escape', defaultPrevented: true, focusInside: true }), 'an inner popover consumed it')
  assert.ok(!model.shouldCloseOnEscape({ key: 'Escape', defaultPrevented: false, focusInside: false }), 'focus is on the page')
})

test('panel preferences survive blocked or corrupt storage', () => {
  assert.deepEqual(model.readLogPanelPrefs(null), { height: model.LOG_PANEL_DEFAULT_HEIGHT, params: '' })
  assert.deepEqual(model.readLogPanelPrefs({ getItem() { throw new Error('blocked') } }), { height: model.LOG_PANEL_DEFAULT_HEIGHT, params: '' })
  assert.deepEqual(model.readLogPanelPrefs({ getItem: () => '{not json' }), { height: model.LOG_PANEL_DEFAULT_HEIGHT, params: '' })
  assert.deepEqual(model.readLogPanelPrefs({ getItem: () => JSON.stringify({ height: 420.4, params: 'q=a&tab=x' }) }), { height: 420, params: 'q=a' })
  assert.equal(model.writeLogPanelPrefs({ setItem() { throw new Error('quota') } }, { height: 300, params: '' }), false)
  const saved = new Map()
  assert.equal(model.writeLogPanelPrefs({ setItem: (key, value) => saved.set(key, value) }, { height: 300, params: 'q=a' }), true)
  assert.deepEqual(JSON.parse(saved.get(model.LOG_PANEL_STORAGE_KEY)), { height: 300, params: 'q=a' })
})

test('the panel is offered only to principals who can see /logs, and steps aside on /logs itself', () => {
  const routes = [{ path: '/logs', name: '运行日志' }, { path: '/dashboard', name: '首页' }]
  assert.ok(model.logPanelAvailable(routes, UNRESTRICTED_ACCESS))
  assert.ok(model.logPanelAvailable(routes, createConsoleAccess({ permissions: ['status.view'] })))
  assert.ok(!model.logPanelAvailable(routes, createConsoleAccess({ permissions: ['ops.schedule.read'] })))
  assert.ok(!model.logPanelAvailable(routes.slice(1), UNRESTRICTED_ACCESS), 'no /logs route, no panel')
  assert.ok(model.logPanelSuspended('/logs'))
  assert.ok(!model.logPanelSuspended('/logs-archive'))
})

// ---------- LogViewer: controlled filter state ----------

const viewerSource = await source('pages/logs/LogViewer.tsx')
function renderViewer(params, onParamsChange, variant) {
  const runtime = hookRuntime()
  const mod = compile(viewerSource, {
    react: { ...runtime.hooks, useEffect() {}, useLayoutEffect() {} },
    '../../i18n': { useI18n: () => i18n }, '../../utils/auth': { apiFetch: async () => { throw new Error('no network in tests') } },
    '../../components/toast': { useToast: () => ({ success() {}, error() {} }) }, '../../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../../contracts/zhin-console': { CONSOLE_REST: { LOGS: '/api/logs', LOGS_STATS: '/api/logs/stats', LOGS_CLEANUP: '/api/logs/cleanup' } },
    '../../utils/read-error.mjs': readError, './read-state.mjs': readState, '../../utils/console-access.mjs': { hasConsolePermission: () => true },
    './LogWorkbench': { LogWorkbench: 'log-workbench' }, './LogPanelWorkbench': { LogPanelWorkbench: 'log-panel-workbench' },
    '../insights/ScopeFilterBar': { ScopeFilterBar: 'scope-filter-bar' },
    '../insights/scope-filter.mjs': scopeFilter, './history-model.mjs': historyModel,
  })
  const tree = runtime.render(() => mod.LogViewer({ params, onParamsChange, variant }))
  return { tree, workbench: nodes(tree).find(node => node.type === 'log-workbench' || node.type === 'log-panel-workbench'), scopeBar: nodes(tree).find(node => node.type === 'scope-filter-bar') }
}

test('LogViewer reads every filter from its params and reports changes through onParamsChange', () => {
  const changes = []
  const { workbench, scopeBar } = renderViewer(new URLSearchParams('q=boom&level=warn&source=icqq&page=2&pageSize=50&adapter=qq&endpoint=bot-1'), next => changes.push(next.toString()))
  assert.equal(workbench.props.state.query, 'boom')
  assert.equal(workbench.props.state.level, 'warn')
  assert.equal(workbench.props.state.source, 'icqq')
  assert.equal(workbench.props.state.page, 2)
  assert.equal(workbench.type, 'log-workbench', 'the page keeps the full workbench')
  assert.equal(scopeBar.props.filter.identity, 'qq / bot-1')
  workbench.props.actions.changeQuery('timeout')
  workbench.props.actions.selectLevel('error')
  workbench.props.actions.changePage(3)
  scopeBar.props.onClear()
  assert.deepEqual(changes, [
    'q=timeout&level=warn&source=icqq&pageSize=50&adapter=qq&endpoint=bot-1',
    'q=timeout&level=error&source=icqq&pageSize=50&adapter=qq&endpoint=bot-1',
    'q=timeout&level=error&source=icqq&pageSize=50&adapter=qq&endpoint=bot-1&page=3',
    'q=timeout&level=error&source=icqq&pageSize=50',
  ], 'each change builds on the previous one, without waiting for a re-render; filters reset the page')
  const panel = renderViewer(new URLSearchParams('adapter=qq'), () => {}, 'panel')
  assert.equal(panel.workbench.type, 'log-panel-workbench', 'the panel uses the dense workbench with the same state and actions')
  assert.equal(panel.scopeBar, undefined, 'the panel shows the range as a header chip, not the range bar')
})

test('/logs keeps URL-backed filters: deep links like /logs?q=… render and changes replace the URL entry', async () => {
  const runtime = hookRuntime()
  const urlParams = new URLSearchParams('q=schedule&adapter=qq')
  const writes = []
  const page = compile(await source('pages/logs.tsx'), {
    react: runtime.hooks, '../i18n': { useI18n: () => i18n },
    'react-router-dom': { useSearchParams: () => [urlParams, (next, options) => writes.push([next.toString(), options])] },
    '../components/PageHeader': { PageHeader: 'page-header' }, '../components/PageShell': { PageShell: 'page-shell' },
    '../utils/console-access.mjs': { hasConsolePermission: () => false }, './logs/LogViewer': { LogViewer: 'log-viewer' },
  })
  const tree = runtime.render(() => page.default())
  const viewer = nodes(tree).find(node => node.type === 'log-viewer')
  assert.strictEqual(viewer.props.params, urlParams, 'the viewer reads the address bar')
  assert.equal(viewer.props.variant, undefined)
  viewer.props.onParamsChange(new URLSearchParams('q=cron'))
  assert.deepEqual(writes, [['q=cron', { replace: true }]])
})

// ---------- LogPanel: placement, permissions, focus, Escape, shortcut ----------

const panelSource = await source('components/log-panel/LogPanel.tsx')
function panelFixture({ pathname = '/scope/qq/bot-1', mobile = false, access = UNRESTRICTED_ACCESS, routes = [{ path: '/logs', name: '运行日志' }] } = {}) {
  const env = browser({ pathname })
  const runtime = hookRuntime()
  const mod = compile(panelSource, {
    react: runtime.hooks,
    'react-router-dom': { Link: 'a', useLocation: () => ({ pathname, search: '' }) },
    'lucide-react': lucide, '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../i18n': { useI18n: () => i18n }, '../ui/button': { Button: 'button' }, '../../pages/logs/LogViewer': { LogViewer: 'log-viewer' },
    '../../hooks/useIsMobile': { useIsMobile: () => mobile }, '../../hooks/use-console-access': { useConsoleAccess: () => access },
    '../../utils/console-client': { app: { subscribe() { return () => {} }, getRoutes: () => routes } },
    './log-panel-store.mjs': storeModule, './log-panel-model.mjs': model, '../../pages/insights/scope-filter.mjs': scopeFilter,
  })
  return {
    env, mod,
    render: () => runtime.render(() => mod.LogPanel()),
    button: () => runtime.render(() => mod.LogPanelButton()),
    close() { runtime.unmount(); env.restore(); storeModule.closeLogPanel() },
  }
}
const panelOf = tree => nodes(tree).find(node => node.type === 'section' && node.props.id === model.LOG_PANEL_ID)

test('docked panel: full-width region at the bottom, no backdrop, not modal; the viewer mounts only while it is open', () => {
  storeModule.closeLogPanel()
  const f = panelFixture()
  try {
    assert.equal(f.render(), null, 'closed: nothing mounted, so nothing polls')
    storeModule.openLogPanel({ q: 'boom' })
    const tree = f.render()
    const panel = panelOf(tree)
    assert.equal(panel.props.role, 'region')
    assert.equal(panel.props['aria-modal'], undefined)
    assert.match(panel.props.className, /is-docked/)
    assert.ok(!nodes(tree).some(node => /scrim/.test(node.props?.className ?? '')), 'no backdrop')
    assert.ok(!nodes(tree).some(node => 'inert' in (node.props ?? {})), 'nothing is made inert')
    const viewer = nodes(tree).find(node => node.type === 'log-viewer')
    assert.equal(viewer.props.variant, 'panel')
    assert.equal(viewer.props.params.toString(), 'q=boom')
    viewer.props.onParamsChange(new URLSearchParams('q=boom&level=error'))
    assert.equal(storeModule.logPanelStore.get().params, 'level=error&q=boom', 'filter changes stay in the panel state')
    const separator = nodes(tree).find(node => node.props?.role === 'separator')
    assert.equal(separator.props.tabIndex, 0, 'the drag handle is keyboard-resizable')
    assert.equal(separator.props['aria-valuemin'], model.LOG_PANEL_MIN_HEIGHT)
    const link = nodes(f.render()).find(node => node.type === 'a')
    assert.equal(link.props.to, '/logs?level=error&q=boom', '在日志页打开 carries the same filter')
    assert.equal(f.env.styleProps.get('--console-log-panel-reserve'), `${storeModule.logPanelStore.get().height}px`, 'the page reserves the panel height')
    storeModule.closeLogPanel()
    assert.equal(f.render(), null)
    assert.equal(f.env.styleProps.has('--console-log-panel-reserve'), false)
  } finally { f.close() }
})

test('phone sheet is modal; on /logs and for principals without status.view the panel and its button stay away', () => {
  storeModule.openLogPanel()
  const phone = panelFixture({ mobile: true })
  try {
    const tree = phone.render()
    assert.equal(panelOf(tree).props.role, 'dialog')
    assert.equal(panelOf(tree).props['aria-modal'], true)
    assert.ok(nodes(tree).some(node => node.props?.className === 'console-log-panel-scrim'))
    assert.ok(!nodes(tree).some(node => node.props?.role === 'separator'), 'the sheet has no resize handle')
  } finally { phone.close() }
  storeModule.openLogPanel()
  const onLogs = panelFixture({ pathname: '/logs' })
  try {
    assert.equal(onLogs.render(), null, 'the /logs page already polls the same logs')
    assert.equal(onLogs.button().props.disabled, true)
  } finally { onLogs.close() }
  storeModule.openLogPanel()
  const viewer = panelFixture({ access: createConsoleAccess({ permissions: ['ops.schedule.read'] }) })
  try {
    assert.equal(viewer.render(), null)
    assert.equal(viewer.button(), null)
  } finally { viewer.close() }
})

test('top-bar button: icon with tooltip, aria-expanded / aria-controls follow the panel', () => {
  storeModule.closeLogPanel()
  const f = panelFixture()
  try {
    let button = f.button()
    assert.equal(button.props['aria-expanded'], false)
    assert.equal(button.props['aria-controls'], model.LOG_PANEL_ID)
    assert.match(button.props.title, /打开日志面板（Ctrl `）/)
    button.props.onClick()
    button = f.button()
    assert.equal(button.props['aria-expanded'], true)
    assert.equal(button.props['aria-label'], '关闭日志面板')
  } finally { f.close() }
})

test('focus moves into the panel and back to the opener; Escape closes only from inside and only when not consumed', () => {
  storeModule.closeLogPanel()
  const f = panelFixture()
  try {
    f.render()
    const opener = { isConnected: true, focused: 0, focus() { this.focused++ } }
    globalThis.document.activeElement = opener
    storeModule.openLogPanel({ adapter: 'qq' })
    // First render attaches nothing (no DOM); give the section its ref, then re-run the open effects.
    let tree = f.render()
    const inside = { isConnected: true }
    let panelFocused = 0
    panelOf(tree).props.ref.current = { contains: node => node === inside, focus() { panelFocused++; globalThis.document.activeElement = inside } }
    storeModule.openLogPanel({ adapter: 'qq' })
    tree = f.render()
    assert.ok(panelFocused >= 1, 'focus moves into the panel')

    globalThis.document.activeElement = { isConnected: true }
    f.env.keyDown({ key: 'Escape' })
    assert.equal(storeModule.logPanelStore.get().open, true, 'Escape on the page does not close the panel')
    globalThis.document.activeElement = inside
    f.env.keyDown({ key: 'Escape', defaultPrevented: true })
    assert.equal(storeModule.logPanelStore.get().open, true, 'an inner popover consumed Escape')
    const event = f.env.keyDown({ key: 'Escape' })
    assert.equal(event.defaultPrevented, true)
    assert.equal(storeModule.logPanelStore.get().open, false)
    globalThis.document.activeElement = globalThis.document.body // the focused control left with the panel
    f.render()
    assert.equal(opener.focused, 1, 'focus returns to the opener')
  } finally { f.close() }
})

test('Ctrl + ` toggles the panel from any page but not on /logs', () => {
  storeModule.closeLogPanel()
  const f = panelFixture()
  try {
    f.render()
    const event = f.env.keyDown({ ctrlKey: true, code: 'Backquote', key: '`' })
    assert.equal(event.defaultPrevented, true)
    assert.equal(storeModule.logPanelStore.get().open, true)
    f.render()
    f.env.keyDown({ ctrlKey: true, code: 'KeyK', key: 'k' })
    assert.equal(storeModule.logPanelStore.get().open, true, 'Ctrl K stays with the command center')
    f.env.keyDown({ ctrlKey: true, code: 'Backquote', key: '`' })
    assert.equal(storeModule.logPanelStore.get().open, false)
    globalThis.window.location.pathname = '/logs'
    const onLogs = f.env.keyDown({ ctrlKey: true, code: 'Backquote', key: '`' })
    assert.equal(onLogs.defaultPrevented, false)
    assert.equal(storeModule.logPanelStore.get().open, false)
  } finally { f.close() }
})

test('panel restores the last filters and height from localStorage, unless a page opened it with a filter first', () => {
  storeModule.closeLogPanel()
  storeModule.logPanelStore.hydrate({ params: '', height: model.LOG_PANEL_DEFAULT_HEIGHT })
  const f = panelFixture()
  try {
    f.env.saved.set(model.LOG_PANEL_STORAGE_KEY, JSON.stringify({ height: 300, params: 'level=error' }))
    // A fresh store (revision 0) hydrates; the shared one may already have been opened by earlier tests.
    const fresh = storeModule.createLogPanelStore()
    assert.equal(fresh.get().revision, 0)
    fresh.hydrate(model.readLogPanelPrefs(globalThis.window.localStorage))
    assert.deepEqual({ height: fresh.get().height, params: fresh.get().params }, { height: 300, params: 'level=error' })
    storeModule.openLogPanel({ q: 'x' })
    f.render(); f.render()
    assert.deepEqual(JSON.parse(f.env.saved.get(model.LOG_PANEL_STORAGE_KEY)).params, 'q=x', 'the panel writes its own filters back')
  } finally { f.close() }
})

// ---------- Deep links from pages ----------

test('login task cards open the panel filtered to their adapter and account, without leaving the page', async () => {
  const runtime = hookRuntime()
  let available = true
  const mod = compile(await source('pages/scope/login-tasks.tsx'), {
    react: { ...runtime.hooks, useEffect() {} },
    '../../hooks/use-instance-recovery': { useInstanceRecovery() {} }, 'lucide-react': lucide, '../../i18n': { useI18n: () => i18n },
    '../../components/ui/badge': { Badge: 'span' }, '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ActionReceipt': { ActionReceipt: 'receipt', useActionReceipt: () => ({ state: { phase: 'idle' }, prepare() {} }) },
    '../../components/action-receipt-model.mjs': { receiptBlocksActions: () => false }, '../../contracts/zhin-console': { ENDPOINT_RPC: {} },
    '../../hooks/visible-polling.mjs': { startVisiblePolling: () => () => {} }, '../../hooks/use-console-access': { useConsoleAccess: () => UNRESTRICTED_ACCESS },
    '../../utils/console-access.mjs': { hasConsolePermission: () => true }, '../../utils/console-rpc': { requestConsole: async () => ({}) },
    '../endpoint-list-model.mjs': { readEndpointList: () => [] },
    '../../components/log-panel/LogPanel': { useLogPanel: () => ({ available, open: storeModule.openLogPanel }) },
    './login-flow-model.mjs': loginFlowModel,
  })
  const task = { id: 't1', adapter: 'telegram', endpointKey: 'preview-support', type: 'sms', payload: { message: '输入验证码' } }
  storeModule.closeLogPanel()
  const tree = runtime.render(() => mod.LoginTaskCard({ task, onSettled() {}, readOnly: false }))
  const button = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '查看 preview-support 的日志')
  assert.ok(button, 'each card has a 查看日志 action')
  assert.equal(text(button), '查看日志')
  button.props.onClick()
  assert.deepEqual({ open: storeModule.logPanelStore.get().open, params: storeModule.logPanelStore.get().params }, { open: true, params: 'adapter=telegram&endpoint=preview-support' })
  storeModule.closeLogPanel()
  available = false
  const hidden = runtime.render(() => mod.LoginTaskCard({ task, onSettled() {}, readOnly: false }))
  assert.ok(!nodes(hidden).some(node => node.props?.['aria-label'] === '查看 preview-support 的日志'), 'hidden without access to /logs')
})

test('pages where staying put is better open the panel; the /logs?q= link stays as the fallback', async () => {
  const welcome = await source('pages/welcome-use-case.tsx')
  assert.match(welcome, /logPanel\.open\(\{ q: selected\.instanceKey \}\)/)
  assert.match(welcome, /to=\{`\/logs\?q=\$\{encodeURIComponent\(selected\.instanceKey\)\}`\}/)
  const dashboard = await source('pages/dashboard.tsx')
  assert.match(dashboard, /navigate\(.*'\/logs\?level=error'/, 'dashboard alerts still go to the full page')
})

// ---------- Panel variant structure ----------

test('panel workbench: one toolbar row, single-line rows, no section header, count and pager in a one-line footer', async () => {
  const runtime = hookRuntime()
  const mod = compile(await source('pages/logs/LogPanelWorkbench.tsx'), {
    react: runtime.hooks, 'lucide-react': lucide, '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') }, '../../i18n': { useI18n: () => i18n },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/checkbox': { Checkbox: 'checkbox' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select-field' }, '../../components/error-alert': { ErrorAlert: 'error-alert' }, '../../components/ui/list-item-button': { ListItemButton: 'button' },
    '../../components/ui/dropdown-menu': Object.fromEntries(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuSeparator', 'DropdownMenuCheckboxItem'].map(name => [name, name])),
    './history-model.mjs': historyModel,
    './LogWorkbench': { getLevelMeta: level => ({ label: level, icon: 'LevelIcon', className: `is-${level}` }), formatLogTime: () => '12:00:00', LogInspector: 'log-inspector' },
  })
  const logs = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, level: index ? 'info' : 'error', source: 'icqq', message: `message ${index} `.repeat(30), timestamp: '2026-11-13T00:00:00Z' }))
  const calls = []
  const actions = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) })
  const state = { logs, stats: null, level: 'all', query: '', autoScroll: true, error: null, readOnly: false, logsKnown: true, canManage: true, loading: false, source: '', page: 1, pageSize: 100, total: 250, totalPages: 3, sources: [] }
  const render = () => runtime.render(() => mod.LogPanelWorkbench({ state, actions, endRef: { current: null } }))
  let tree = render()
  const toolbar = nodes(tree).find(node => node.props?.className === 'console-log-panel-toolbar')
  const kinds = nodes(toolbar).filter(node => ['input', 'select-field', 'checkbox', 'button'].includes(node.type)).map(node => node.type === 'button' ? node.props['aria-label'] : node.type)
  assert.deepEqual(kinds, ['input', 'select-field', 'checkbox', '刷新', '来源筛选', '更多日志选项'], 'search, level, follow, refresh, sources, overflow in one row')
  for (const button of nodes(toolbar).filter(node => node.type === 'button')) assert.equal(button.props.title, button.props['aria-label'], 'icon buttons carry a tooltip')
  assert.ok(nodes(toolbar).some(node => node.type === 'DropdownMenuCheckboxItem'), 'page size lives in the overflow menu')
  assert.ok(!nodes(tree).some(node => node.type === 'h2'), 'no 历史事件 header')
  const rows = nodes(tree).filter(node => node.type === 'button' && node.props.className?.includes('console-log-panel-row'))
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0].props.children.map(child => child.type), ['time', 'LevelIcon', 'code', 'span'], 'time · level · source · message on one line')
  assert.equal(rows[0].props.title, logs[0].message, 'the truncated message is available in full')
  const footer = nodes(tree).find(node => node.type === 'nav')
  assert.match(text(footer), /1\/3 · 250 条/)
  nodes(footer).find(node => node.props?.['aria-label'] === '下一页').props.onClick()
  assert.deepEqual(calls.at(-1), ['changePage', 2])
  rows[1].props.onClick()
  tree = render()
  assert.ok(nodes(tree).some(node => node.type === 'log-inspector'), 'a row opens the shared inspector')
})

test('panel header: the range is a chip with open-object and clear; the text-matching caveat is its tooltip', () => {
  storeModule.openLogPanel({ adapter: 'qq', endpoint: 'bot-1', q: 'boom' })
  const f = panelFixture()
  try {
    const tree = f.render()
    const chip = nodes(tree).find(node => node.props?.className === 'console-log-panel-scope')
    assert.equal(text(nodes(chip).find(node => node.type === 'code')), 'qq / bot-1')
    assert.match(chip.props.title, /按文本匹配/)
    const open = nodes(chip).find(node => node.props?.['aria-label'] === '打开对象页')
    assert.equal(open.props.to, '/scope/qq/bot-1')
    assert.equal(open.props.title, '打开对象页')
    nodes(chip).find(node => node.props?.['aria-label'] === '清除范围').props.onClick()
    assert.equal(storeModule.logPanelStore.get().params, 'q=boom', 'clearing the range keeps the other filters')
    assert.ok(!nodes(f.render()).some(node => node.props?.className === 'console-log-panel-scope'))
  } finally { f.close() }
})
