import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/attention/attention-model.mjs'
import * as visiblePolling from '../console-ui/src/hooks/visible-polling.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return module.exports
}

/** Expands function components so the tree holds only host elements and text. */
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  const children = node.props?.children
  return { ...node, props: { ...node.props, ...(children === undefined ? {} : { children: render(children) }) } }
}
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node !== 'object' ? String(node) : text(node.props?.children)
const icons = new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : String(name) })

function environment(locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const state = new Map()
  const react = {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useSyncExternalStore: (_subscribe, get) => get(),
  }
  const common = {
    react, 'lucide-react': icons, 'react-router-dom': { Link: 'Link' }, '@zhin.js/client': { cn: (...names) => names.filter(Boolean).join(' ') },
    '../../i18n': { useI18n: () => ({ t, locale }) }, '../../components/ui/button': { Button: 'Button' }, './attention-model.mjs': model,
  }
  return { t, state, common }
}

async function components(locale, attention) {
  const env = environment(locale)
  const row = compile(await source('pages/attention/AttentionItemRow.tsx'), env.common)
  const page = compile(await source('pages/attention/index.tsx'), {
    ...env.common,
    '../../components/PageHeader': { PageHeader: ({ title, description, actions }) => ({ type: 'header', props: { children: [title, description, actions] } }) },
    '../../components/PageShell': { PageShell: ({ children }) => ({ type: 'main', props: { children } }) },
    '../../components/StatusState': { StatusState: props => ({ type: 'status-state', props: { ...props, children: [props.title, props.description] } }) },
    '../../components/ui/skeleton': { Skeleton: 'Skeleton' },
    './AttentionItemRow': row,
    './use-attention': { useAttention: () => attention },
  })
  const badge = compile(await source('pages/attention/AttentionBadge.tsx'), { ...env.common, './use-attention': { useAttention: () => attention } })
  return { page: () => render(page.default()), badge: () => render(badge.AttentionBadge()) }
}

const NOW = Date.now()
const item = (overrides = {}) => model.normalizeAttentionItem({
  id: 'login.pending:1', revision: 'r', kind: 'login.pending', severity: 'danger', title: 'icqq / 10001 等待登录', detail: '需要完成扫码才能上线。',
  since: new Date(NOW - 5 * 60_000).toISOString(), action: { label: '去处理登录', path: '/scope/icqq/10001?tab=access' }, source: 'login-assist', ...overrides,
})
function attention(overrides = {}) {
  const calls = []
  const items = overrides.items ?? []
  return {
    calls,
    state: { status: 'ready', refreshing: false, error: null, data: { mode: 'host', items, generatedAt: new Date(NOW).toISOString(), unavailable: [] }, ...overrides.state },
    allowed: true, active: items, snoozed: [], ignored: [], badgeCount: model.attentionBadgeCount(items),
    refresh: () => calls.push(['refresh']), snooze: entry => calls.push(['snooze', entry.id]), ignore: entry => calls.push(['ignore', entry.id]), restore: id => calls.push(['restore', id]),
    ...overrides,
  }
}

test('the page groups items by severity, each with reason, since, 去处理, 稍后提醒 and 忽略', async () => {
  const items = [item(), item({ id: 'endpoint.offline:2', severity: 'warning', kind: 'endpoint.offline', title: 'qq / bot 离线', since: new Date(NOW - 3 * 3_600_000).toISOString() }),
    item({ id: 'logs.errors:3', severity: 'info', kind: 'logs.errors', title: '日志里有 7 条错误', action: { label: '打开错误日志', path: '/logs?level=error' } })]
  const fake = attention({ items })
  const tree = (await components('zh-CN', fake)).page()
  const headings = nodes(tree).filter(node => node.type === 'h2').map(text)
  assert.deepEqual(headings, ['需要立即处理1', '需要处理1', '留意1'])
  const rows = nodes(tree).filter(node => node.type === 'li')
  assert.equal(rows.length, 3)
  assert.match(text(rows[0]), /icqq \/ 10001 等待登录/)
  assert.match(text(rows[0]), /需要完成扫码才能上线/)
  assert.match(text(rows[0]), /5 分钟前出现/)
  const link = nodes(rows[0]).find(node => node.type === 'Link')
  assert.equal(link.props.to, '/scope/icqq/10001?tab=access')
  assert.equal(link.props.title, '去处理登录')
  assert.match(text(link), /去处理/)
  const buttons = nodes(rows[1]).filter(node => node.type === 'Button' && node.props.onClick)
  assert.deepEqual(buttons.map(text), ['稍后提醒', '忽略'])
  buttons[0].props.onClick(); buttons[1].props.onClick()
  assert.deepEqual(fake.calls, [['snooze', 'endpoint.offline:2'], ['ignore', 'endpoint.offline:2']])
  const filters = nodes(tree).filter(node => node.type === 'button' && 'aria-pressed' in node.props)
  assert.deepEqual(filters.map(node => [text(node), node.props['aria-pressed']]), [['待处理3', true], ['已忽略0', false]])
})

test('the empty state says 一切正常 with the last check time, in both languages', async () => {
  const zh = (await components('zh-CN', attention())).page()
  const empty = nodes(zh).find(node => node.props?.className === 'console-attention-empty')
  assert.match(text(empty), /一切正常/)
  assert.match(text(empty), /没有需要你处理的事项。/)
  assert.match(text(empty), /上次检查/)
  assert.equal(empty.props.role, 'status')
  const en = (await components('en', attention({ snoozed: [item()] }))).page()
  const emptyEn = nodes(en).find(node => node.props?.className === 'console-attention-empty')
  assert.match(text(emptyEn), /All clear/)
  assert.match(text(emptyEn), /1 more items are snoozed or ignored/)
  assert.match(text(emptyEn), /Last checked/)
})

test('loading, failure, missing permission and older Hosts use StatusState and say what the list covers', async () => {
  const loading = (await components('zh-CN', attention({ state: { status: 'loading', data: null } }))).page()
  assert.ok(nodes(loading).some(node => node.type === 'Skeleton'))
  const error = new Error('Failed to fetch')
  const failed = (await components('zh-CN', attention({ state: { status: 'error', data: null, error } }))).page()
  const status = nodes(failed).find(node => node.type === 'status-state')
  assert.equal(status.props.error, error)
  assert.equal(typeof status.props.onRetry, 'function')
  const forbidden = (await components('zh-CN', attention({ allowed: false }))).page()
  assert.deepEqual(nodes(forbidden).find(node => node.type === 'status-state').props.permissions, ['status.view'])
  const fallback = (await components('zh-CN', attention({ state: { data: { mode: 'fallback', items: [], generatedAt: null, unavailable: [] } } }))).page()
  assert.match(text(fallback), /当前 Host 版本较旧/)
  const partial = (await components('zh-CN', attention({ state: { data: { mode: 'host', items: [], generatedAt: null, unavailable: ['plugins', 'logs'] } } }))).page()
  assert.match(text(partial), /列表可能不完整：插件、日志/)
})

test('while the instance starts the page says so with 重试 and 查看实例, not the older-Host hint and not an error', async () => {
  const notReady = state => ({ state: { data: { mode: 'instance-not-ready', instance: { state, ready: false }, items: [], generatedAt: new Date(NOW).toISOString(), unavailable: [] } }, instanceNotReady: true })
  const fake = attention(notReady('starting'))
  const tree = (await components('zh-CN', fake)).page()
  const notice = nodes(tree).find(node => node.props?.className === 'console-attention-empty is-instance-not-ready')
  assert.equal(notice.props.role, 'status')
  assert.match(text(notice), /实例启动中…/)
  assert.match(text(notice), /自动读取/)
  assert.doesNotMatch(text(tree), /当前 Host 版本较旧|一切正常/)
  assert.equal(nodes(tree).some(node => node.type === 'status-state'), false)
  const retry = nodes(notice).find(node => node.type === 'Button' && node.props.onClick)
  assert.match(text(retry), /重试/)
  retry.props.onClick()
  assert.deepEqual(fake.calls, [['refresh']])
  assert.equal(nodes(notice).find(node => node.type === 'Link').props.to, '/ops/instance')
  const crashed = (await components('en', attention(notReady('crashed')))).page()
  assert.match(text(crashed), /Instance: Crashed/)
  // The badge shows no count and says why.
  const badge = (await components('zh-CN', attention(notReady('starting')))).badge()
  assert.equal(badge.props['aria-label'], '需要你处理：实例启动中…')
  assert.equal(nodes(badge).some(node => node.props?.className?.includes('console-attention-badge-count')), false)
})

test('the badge counts danger + warning items, links to /attention and hides without status.view', async () => {
  const items = [item(), item({ id: 'b', severity: 'warning' }), item({ id: 'c', severity: 'info' })]
  const tree = (await components('zh-CN', attention({ items }))).badge()
  assert.equal(tree.type, 'Link')
  assert.equal(tree.props.to, '/attention')
  assert.equal(tree.props['aria-label'], '需要你处理：2 项')
  assert.equal(text(nodes(tree).find(node => node.props?.className?.includes('console-attention-badge-count'))), '2')
  assert.ok(nodes(tree).some(node => node.props?.className === 'console-attention-badge-count is-danger'))
  const quiet = (await components('en', attention({ items: [item({ severity: 'info' })] }))).badge()
  assert.equal(quiet.props['aria-label'], 'Needs your attention: nothing to do')
  assert.equal(nodes(quiet).some(node => node.props?.className?.includes('console-attention-badge-count')), false)
  assert.equal((await components('zh-CN', attention({ allowed: false }))).badge(), null)
})

test('one shared read: refresh every 30 s while visible, on focus and on push events (debounced), stopped with the last subscriber', async () => {
  const requests = []
  const handlers = new Map()
  const polls = []
  const windowListeners = new Map()
  let gap = null
  let recovered = null
  globalThis.window = {
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: name => windowListeners.delete(name),
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  const timers = []
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = () => {} }
  try {
    const store = compile(await source('pages/attention/use-attention.ts'), {
      react: environment().common.react,
      '@zhin.js/client': { SIDE_EVENT_PUSH: { ENDPOINT_LIFECYCLE: 'endpoint.lifecycle', LOGIN_PENDING: 'endpoint.login.pending', LOGIN_EXPIRED: 'endpoint.login.expired', REQUEST_RECEIVE: 'request.receive' } },
      '../../i18n': { useI18n: () => ({ locale: 'zh-CN' }) },
      '../../i18n/locale.mjs': { translate },
      '../../contracts/zhin-console': { CONSOLE_REST: { STATS: '/api/stats', LOGS_STATS: '/api/logs/stats', INTROSPECTION: '/api/introspection' } },
      '../../hooks/visible-polling.mjs': { startVisiblePolling: (fn, ms) => { polls.push({ fn, ms, stopped: false }); const entry = polls.at(-1); return () => { entry.stopped = true } } },
      '../../hooks/use-console-access': { useConsoleAccess: () => ({}) },
      '../../hooks/use-console-session': { useConsoleSession: () => ({ me: null }) },
      '../../utils/auth': { apiFetch: async () => { throw new Error('unused') }, getApiBase: () => '', probeHealth: async () => ({ ok: true, instance: { state: 'running', ready: true } }) },
      '../../utils/console-client': { getConsoleTransport: () => ({
        onConsoleEvent: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type) },
        onConsoleEventRecoveryGap: fn => { gap = fn; return () => { gap = null } },
      }) },
      '../../utils/console-access.mjs': { hasConsolePermission: () => true },
      '../../utils/console-rpc': { requestConsole: async request => { requests.push(request); return { items: [], generatedAt: new Date().toISOString() } } },
      '../../utils/instance-availability.mjs': { onInstanceRecovered: fn => { recovered = fn; return () => { recovered = null } } },
      '../../utils/read-error.mjs': { readErrorSummary: () => '' },
      '../dashboard-health': { summarizeOptional: () => ({}) },
      '../logs/read-state.mjs': { logPayloadAvailability: () => ({ available: true }) },
      './attention-model.mjs': model,
    })
    const offA = store.subscribeAttention(() => {})
    const offB = store.subscribeAttention(() => {})
    assert.equal(requests.length, 1, 'one read for any number of subscribers')
    assert.deepEqual(requests[0], { type: 'attention.list', data: { locale: 'zh-CN' } })
    assert.equal(polls.length, 1)
    assert.equal(polls[0].ms, 30_000)
    assert.deepEqual([...handlers.keys()].sort(), ['endpoint.lifecycle', 'endpoint.login.expired', 'endpoint.login.pending', 'request.receive'])
    handlers.get('endpoint.login.pending')()
    handlers.get('endpoint.lifecycle')()
    windowListeners.get('focus')()
    gap()
    recovered()
    const pending = timers.filter(timer => timer.ms === model.ATTENTION_PUSH_DEBOUNCE_MS)
    for (const timer of pending) timer.fn()
    assert.equal(requests.length, 2, 'a burst of push / focus events is one more read')
    polls[0].fn()
    assert.equal(requests.length, 3)
    await new Promise(resolve => realSetTimeout(resolve, 0))
    assert.equal(store.getAttentionState().status, 'ready')
    offA()
    assert.equal(polls[0].stopped, false)
    offB()
    assert.equal(polls[0].stopped, true)
    assert.equal(handlers.size, 0)
    assert.equal(windowListeners.has('focus'), false)
    assert.equal(gap, null)
    assert.equal(recovered, null)
  } finally {
    delete globalThis.window
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = clearTimeout
  }
  assert.equal(typeof visiblePolling.startVisiblePolling, 'function')
})

test('while the instance starts the shared read asks /pub/health and reads again sooner, until it is ready', async () => {
  const requests = []
  let health = { ok: true, instance: { state: 'starting', ready: false } }
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, localStorage: { getItem: () => null, setItem: () => {} } }
  const timers = []
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = () => {} }
  const settle = () => new Promise(resolve => realSetTimeout(resolve, 0))
  try {
    const store = compile(await source('pages/attention/use-attention.ts'), {
      react: environment().common.react,
      '@zhin.js/client': { SIDE_EVENT_PUSH: {} },
      '../../i18n': { useI18n: () => ({ locale: 'zh-CN' }) },
      '../../i18n/locale.mjs': { translate },
      '../../contracts/zhin-console': { CONSOLE_REST: {} },
      '../../hooks/visible-polling.mjs': { startVisiblePolling: () => () => {} },
      '../../hooks/use-console-access': { useConsoleAccess: () => ({}) },
      '../../hooks/use-console-session': { useConsoleSession: () => ({ me: null }) },
      '../../utils/auth': { apiFetch: async () => { throw new Error('unused') }, getApiBase: () => 'http://host', probeHealth: async () => health },
      '../../utils/console-client': { getConsoleTransport: () => ({ onConsoleEvent: () => () => {}, onConsoleEventRecoveryGap: () => () => {} }) },
      '../../utils/console-access.mjs': { hasConsolePermission: () => true },
      '../../utils/console-rpc': { requestConsole: async request => {
        requests.push(request)
        throw Object.assign(new Error('instance unavailable'), { details: { serverCode: 'instance_unavailable', httpStatus: 503 } })
      } },
      '../../utils/instance-availability.mjs': { onInstanceRecovered: () => () => {} },
      '../../utils/read-error.mjs': { readErrorSummary: () => '' },
      '../dashboard-health': { summarizeOptional: () => ({}) },
      '../logs/read-state.mjs': { logPayloadAvailability: () => ({ available: true }) },
      './attention-model.mjs': model,
    })
    const off = store.subscribeAttention(() => {})
    await settle()
    assert.equal(store.getAttentionState().status, 'ready')
    assert.equal(store.getAttentionState().data.mode, 'instance-not-ready')
    const sooner = timers.filter(timer => timer.ms === model.ATTENTION_NOT_READY_REFRESH_MS)
    assert.equal(sooner.length, 1)
    // Ready now, but still refused: the error is reported as before and no sooner read is scheduled.
    health = { ok: true, instance: { state: 'running', ready: true } }
    sooner[0].fn()
    await settle()
    assert.equal(requests.length, 2)
    assert.equal(store.getAttentionState().data.mode, 'instance-not-ready', 'the last list stays')
    assert.match(String(store.getAttentionState().error?.message), /instance unavailable/)
    assert.equal(timers.filter(timer => timer.ms === model.ATTENTION_NOT_READY_REFRESH_MS).length, 1)
    off()
  } finally {
    delete globalThis.window
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
})

test('the dashboard shows the top items from the shared model with 查看全部 (count); the shell inserts only the badge', async () => {
  const dashboard = await source('pages/dashboard.tsx')
  assert.match(dashboard, /const attention = useAttention\(\)/)
  assert.match(dashboard, /attention\.active\.slice\(0, DASHBOARD_ATTENTION_LIMIT\)/)
  assert.match(dashboard, /i18n\.t\("查看全部 \(\{0\}\)", \[attention\.active\.length\]\)/)
  assert.match(dashboard, /<Link to=\{ATTENTION_PATH\}>/)
  assert.doesNotMatch(dashboard, /attentionItems/)
  const layout = await source('layouts/dashboard.tsx')
  assert.equal(layout.match(/<AttentionBadge \/>/g)?.length, 1, 'one element in the top bar')
  assert.match(layout, /<ConsoleCommandCenter routes=\{routes\} \/>\n\s+<LogPanelButton \/>\n\s+<AttentionBadge \/>/)
  const css = await source('pages/attention/attention.css')
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.console-attention-row-actions \{ grid-column: 1 \/ -1; display: grid; grid-template-columns: 1fr 1fr; \}[\s\S]*\.console-attention-row-actions > \* \{ width: 100%; min-height: 44px; \}/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|rgb\(/iu, 'design tokens only')
})
