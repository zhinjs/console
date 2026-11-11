import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as engagementsModel from '../console-ui/src/pages/engagements-model.mjs'
import * as workbenchModel from '../console-ui/src/pages/agent-workbench-model.mjs'

const { introspectionTotal, fetchAllIntrospection } = workbenchModel
const require = createRequire(import.meta.url)
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(source, mocks, extras = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions }).outputText
  new Function('require', 'exports', 'module', ...Object.keys(extras), code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module, ...Object.values(extras))
  return module.exports
}

/** Minimal hook runtime: re-renders until state settles, runs effects after each pass. */
function hookRuntime() {
  let slots = [], cursor = 0, dirty = false
  const effects = []
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; dirty = true }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, value: fn }; return slots[index].value },
    useMemo(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value },
    useEffect(effect, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect() }) } },
  }
  return {
    hooks,
    mount(component) {
      let tree
      const render = () => { let count = 0; do { assert.ok(++count < 30); dirty = false; cursor = 0; tree = component(); effects.splice(0).forEach(effect => effect()) } while (dirty); return tree }
      return {
        render,
        async settle() { for (let count = 0; count < 30; count++) { await new Promise(resolve => setImmediate(resolve)); if (dirty || effects.length) render() } return tree },
        get tree() { return tree },
        close() { slots.forEach(slot => slot?.cleanup?.()); slots = [] },
      }
    },
  }
}
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children, node.props?.actions].flat(Infinity).flatMap(elements)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ofType = (tree, type) => elements(tree).filter(node => node.type === type)

// ---------------------------------------------------------------------------
// Workroom collaboration records (Engagements)
// ---------------------------------------------------------------------------

const workroomSource = await read('pages/workrooms.tsx')
function workroomFixture(initial) {
  const runtime = hookRuntime()
  const params = new URLSearchParams()
  const state = { engagements: [], loading: true, error: null, reloads: 0, ...initial }
  const module = compile(workroomSource + '\nexport { WorkroomBoardPage };', {
    react: runtime.hooks,
    'react-router-dom': { Link: 'a', useSearchParams: () => [params, () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
    '@zhin.js/client': {
      cn: (...classes) => classes.filter(Boolean).join(' '),
      useEngagements: () => ({ engagements: state.engagements, loading: state.loading, error: state.error, reload: async () => { state.reloads++ } }),
      useEngagementDetail: () => ({ detail: null, loading: false, error: null, reload: async () => {} }),
      useVenues: () => ({ venues: [] }),
    },
    '../hooks/visible-polling.mjs': { startVisiblePolling: () => () => {} },
    '../components/PageHeader': { PageHeader: 'page-header' }, '../components/PageShell': { PageShell: 'page-shell' },
    '../components/error-alert': { ErrorAlert: 'error-alert' }, '../components/empty-state': { EmptyState: 'empty-state' },
    '../components/ui/badge': { Badge: 'span' }, '../components/ui/button': { Button: 'button' },
    '../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/list-item-button': { ListItemButton: 'list-item' },
    '../utils/console-access.mjs': { hasConsolePermission: () => true },
    './engagements-model.mjs': engagementsModel,
  })
  const view = runtime.mount(() => module.WorkroomBoardPage())
  view.render()
  // The page shows its skeleton until the first load finishes: finish it with the given outcome.
  const finish = async (outcome) => { Object.assign(state, { loading: false }, outcome); view.render(); await view.settle() }
  return Object.assign(view, { state, finish })
}
const emptyTitles = tree => ofType(tree, 'empty-state').map(node => node.props.title)

test('Workroom collaboration read failure shows an error with retry, not the "no records yet" empty state', async () => {
  const f = workroomFixture()
  await f.finish({ error: '连接已断开' })
  assert.ok(!emptyTitles(f.tree).includes('还没有协作记录'), 'a failed read must not claim there are no records')
  const alerts = ofType(f.tree, 'error-alert')
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].props.error, /连接已断开/)
  assert.equal(typeof alerts[0].props.onRetry, 'function')
  alerts[0].props.onRetry()
  assert.equal(f.state.reloads, 1, 'retry reloads the collaboration records')
  f.close()
})

test('Workroom collaboration list that is genuinely empty shows the empty guidance without an error', async () => {
  const f = workroomFixture()
  await f.finish({ engagements: [] })
  assert.equal(ofType(f.tree, 'error-alert').length, 0)
  assert.ok(emptyTitles(f.tree).includes('还没有协作记录'))
  f.close()
})

// ---------------------------------------------------------------------------
// Agent workbench tool / binding counts
// ---------------------------------------------------------------------------

const workbenchSource = await read('pages/agent-workbench.tsx')
const dashboardHealth = compile(await read('pages/dashboard-health.ts'), {})
function workbenchFixture(sizes) {
  const runtime = hookRuntime(), requests = []
  const rows = Object.fromEntries(Object.entries(sizes).map(([kind, size]) => [kind, Array.from({ length: size }, (_, i) => (
    kind === 'bindings' ? { name: `agent-${i}`, provider: 'p', model: 'm', mcpServers: [], hasAgentFile: false }
      : kind === 'mcp' ? { name: `mcp-${i}`, connected: true, toolCount: 1 } : { name: `tool-${i}`, description: '' }))]))
  const apiFetch = async url => {
    requests.push(url)
    const parsed = new URL(url, 'https://host'), kind = parsed.pathname.split('/').pop()
    const page = Number(parsed.searchParams.get('page') ?? 1), pageSize = Number(parsed.searchParams.get('pageSize') ?? 15)
    const all = rows[kind] ?? [], totalPages = Math.max(1, Math.ceil(all.length / pageSize)), safe = Math.min(Math.max(1, page), totalPages)
    const data = { items: all.slice((safe - 1) * pageSize, safe * pageSize), page: safe, pageSize, total: all.length, totalPages }
    return { ok: true, json: async () => ({ success: true, data }) }
  }
  const module = compile(workbenchSource, {
    react: runtime.hooks,
    'react-router-dom': { Link: 'a' }, 'lucide-react': new Proxy({}, { get: () => 'i' }),
    '@zhin.js/client': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    './dashboard-health': dashboardHealth,
    '../contracts/zhin-console': { CONSOLE_REST: { INTROSPECTION: '/api/introspection' }, ENDPOINT_RPC: { LIST: 'endpoint:list' } },
    '../utils/auth': { apiFetch },
    '../utils/console-rpc': { requestConsole: async () => ({ endpoints: [{ name: 'e', adapter: 'a', connected: true }] }) },
    '../utils/agent-session-history': { loadAgentSessionHistory: () => [] },
    '../utils/agent-session': { agentSessionsPath: key => `/agent/sessions/${key}`, parseImSessionKey: () => null, SESSION_SCOPE_LABELS: {} },
    '../components/PageHeader': { PageHeader: 'page-header' },
    '../components/ui/button': { Button: 'button', buttonVariants: () => '' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/error-alert': { ErrorAlert: 'error-alert' },
    './agent-workbench-model.mjs': workbenchModel,
  })
  const view = runtime.mount(() => module.default())
  view.render()
  return Object.assign(view, { requests })
}
const metric = (tree, label) => elements(tree).find(node => node.type === 'div' && [node.props?.children].flat().some(child => child?.type === 'span' && text(child) === label))

test('Agent workbench counts every registered tool, not just the first 100', async () => {

  const f = workbenchFixture({ tools: 250, bindings: 2, mcp: 1 })
  await f.settle()
  assert.equal(text(ofType(metric(f.tree, '工具'), 'strong')[0]), '250')
  assert.match(text(f.tree), /250 个工具已注册/)
  assert.doesNotMatch(text(f.tree), /100 个工具已注册/)
  f.close()
})

test('Agent workbench lists every binding across pages, and says so explicitly when the page cap truncates the list', async () => {
  const all = workbenchFixture({ tools: 1, bindings: 130, mcp: 0 })
  await all.settle()
  assert.equal(ofType(all.tree, 'article').length, 130)
  assert.equal(text(ofType(metric(all.tree, 'Agent'), 'strong')[0]), '130')
  assert.doesNotMatch(text(all.tree), /仅显示前/)
  all.close()

  const capped = workbenchFixture({ tools: 1, bindings: 2050, mcp: 0 })
  await capped.settle()
  assert.equal(ofType(capped.tree, 'article').length, 2000)
  assert.equal(text(ofType(metric(capped.tree, 'Agent'), 'strong')[0]), '2050')
  const note = elements(capped.tree).find(node => /仅显示前 2000 个，共 2050 个/.test(text(node)) && node.type === 'p')
  assert.ok(note, 'truncation must be stated with both counts')
  assert.ok(elements(note).some(node => node.type === 'a' && node.props.to === '/introspection?tab=bindings'), 'truncation note links to the full catalog')
  capped.close()
})

test('introspection model pages until total, trusts consistent totals and stops on clamped pages', async () => {
  assert.equal(introspectionTotal({ items: [1, 2], total: 9 }), 9)
  assert.equal(introspectionTotal({ items: [1, 2], total: 1 }), 2)
  assert.equal(introspectionTotal({ items: [1, 2] }), 2)
  assert.equal(introspectionTotal(null), 0)

  const pages = []
  const source = Array.from({ length: 23 }, (_, i) => i)
  const fetchPage = async (page, pageSize) => { pages.push(page); return { items: source.slice((page - 1) * pageSize, page * pageSize), page, total: source.length, note: 'n' } }
  assert.deepEqual(await fetchAllIntrospection(fetchPage, { pageSize: 10 }), { note: 'n', items: source, total: 23, truncated: false })
  assert.deepEqual(pages, [1, 2, 3])

  const capped = await fetchAllIntrospection(fetchPage, { pageSize: 10, maxPages: 2 })
  assert.equal(capped.items.length, 20); assert.equal(capped.total, 23); assert.equal(capped.truncated, true)

  // Host clamps an out-of-range page back to the last page: never duplicate rows.
  const clamped = await fetchAllIntrospection(async page => ({ items: ['a'], page: 1, total: 3 }), { pageSize: 1 })
  assert.deepEqual(clamped, { note: undefined, items: ['a'], total: 3, truncated: true })
})
