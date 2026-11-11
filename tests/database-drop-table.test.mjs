import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

const pageUrl = new URL('../console-ui/src/pages/database/database-page.tsx', import.meta.url)
const hookUrl = new URL('../console-ui/src/pages/database/use-database-console.ts', import.meta.url)
const pageSource = await readFile(pageUrl, 'utf8')
const hookSource = await readFile(hookUrl, 'utf8')
const requireFromPage = createRequire(pageUrl)

function runtime() {
  const slots = []; let cursor = 0, dirty = false, render, value
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; dirty = true } }]
    },
    useMemo(fn) { cursor++; return fn() },
    useCallback(fn) { cursor++; return fn },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect() { cursor++ },
  }
  return {
    hooks,
    mount(fn) { render = fn; return this.render() },
    render() {
      let count = 0
      do { assert.ok(++count < 30, 'render must settle'); dirty = false; cursor = 0; value = render() } while (dirty)
      return value
    },
    get value() { return value },
  }
}

const elements = value => value && typeof value === 'object'
  ? [value, ...[value.props?.children, value.props?.actions].flat(Infinity).flatMap(elements)]
  : []
const text = value => value == null || typeof value === 'boolean' ? ''
  : typeof value !== 'object' ? String(value)
  : Array.isArray(value) ? value.map(text).join('')
  : text(value.props?.children)

function compile(source, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromPage(name), module.exports, module)
  return module.exports
}

function fixture({ dropTable }) {
  const r = runtime(), toasts = []
  const console = {
    info: { type: 'related', dialect: 'sqlite' },
    tables: [{ name: 'users', columns: { id: { type: 'integer', primary: true } } }, { name: 'logs', columns: {} }],
    loaded: true, loading: false, error: null,
    loadInfo: async () => {}, loadTables: async () => {}, dropTable,
  }
  const mocks = {
    react: { ...r.hooks },
    './use-database-console': { useDatabaseConsole: () => console },
    '../../utils/read-error.mjs': { readErrorSummary: value => String(value) },
    '../../utils/console-access.mjs': { hasConsolePermission: () => true },
    '../../components/toast': { useToast: () => ({ success: m => toasts.push(['success', m]), warning: m => toasts.push(['warning', m]), error: m => toasts.push(['error', m]) }) },
    './constants': { DB_TYPE_LABELS: { related: '关系型数据库', document: '文档数据库', keyvalue: '键值数据库' }, DIALECT_LABELS: { sqlite: 'SQLite' } },
    './related-table-view': { RelatedTableView: 'related-view' },
    './document-collection-view': { DocumentCollectionView: 'document-view' },
    './kv-bucket-view': { KvBucketView: 'kv-view' },
    '../../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/badge': { Badge: 'span' },
    '../../components/ui/skeleton': { Skeleton: 'div' },
    '../../components/ui/scroll-area': { ScrollArea: 'div' },
    '../../components/error-alert': { ErrorAlert: 'aside' },
    '../../components/empty-state': { EmptyState: 'empty' },
    '../../components/PageHeader': { PageHeader: 'page-header' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
  const page = compile(pageSource, mocks)
  r.mount(() => page.default())
  const all = () => elements(r.value)
  return {
    r, toasts, console,
    tableButton: name => all().find(node => node.type === 'button' && node.props['data-table'] === name),
    deleteButton: () => all().find(node => node.type === 'button' && node.props['data-action'] === 'drop-table'),
    dialog: () => all().find(node => node.type === 'confirm-dialog'),
    hasRoleButtonDiv: () => all().some(node => node.type === 'div' && node.props.role === 'button'),
  }
}

test('table list items are real buttons and the drop action lives in the selected table header', () => {
  const f = fixture({ dropTable: async () => ({ refreshError: null }) })
  assert.equal(f.hasRoleButtonDiv(), false, 'no div[role=button] wrappers remain')
  assert.equal(f.deleteButton(), undefined, 'no drop button before a table is selected')
  const users = f.tableButton('users')
  assert.ok(users, 'each table is a <button>')
  assert.equal(users.props.type, 'button')
  assert.ok(!elements(users).slice(1).some(node => node.type === 'button'), 'no button is nested inside a table button')

  users.props.onClick(); f.r.render()
  assert.equal(f.tableButton('users').props['aria-current'], 'true')
  const drop = f.deleteButton()
  assert.ok(drop, 'the drop button is shown for the selected table')
  assert.doesNotMatch(String(drop.props.className ?? ''), /opacity-0/, 'the drop button is always visible')
  drop.props.onClick(); f.r.render()
  assert.equal(f.dialog().props.open, true)
  assert.equal(f.dialog().props.confirmText, 'users', 'dropping requires typing the table name')
})

test('a successful drop followed by a failed list refresh still closes the dialog and hides the table', async () => {
  const dropped = []
  const f = fixture({ dropTable: async name => { dropped.push(name); return { refreshError: new Error('刷新超时') } } })
  f.tableButton('users').props.onClick(); f.r.render()
  f.deleteButton().props.onClick(); f.r.render()

  await f.dialog().props.onConfirm()
  f.r.render()
  assert.deepEqual(dropped, ['users'])
  assert.equal(f.dialog().props.open, false, 'the dialog closes because the drop itself succeeded')
  assert.equal(f.tableButton('users'), undefined, 'the dropped table is not offered again from the stale list')
  assert.ok(f.tableButton('logs'))
  assert.equal(f.deleteButton(), undefined, 'the dropped table is deselected')
  assert.equal(f.toasts.length, 1)
  assert.equal(f.toasts[0][0], 'warning')
  assert.match(f.toasts[0][1], /users/)
  assert.match(f.toasts[0][1], /刷新/)
})

test('a failed drop rejects so the dialog can show the error and keep the table', async () => {
  const f = fixture({ dropTable: async () => { throw new Error('外键约束') } })
  f.tableButton('users').props.onClick(); f.r.render()
  f.deleteButton().props.onClick(); f.r.render()
  await assert.rejects(f.dialog().props.onConfirm(), /外键约束/)
  f.r.render()
  assert.equal(f.dialog().props.open, true)
  assert.ok(f.tableButton('users'))
  assert.deepEqual(f.toasts, [])
})

test('a clean drop reports success once', async () => {
  const f = fixture({ dropTable: async () => ({ refreshError: null }) })
  f.tableButton('logs').props.onClick(); f.r.render()
  f.deleteButton().props.onClick(); f.r.render()
  await f.dialog().props.onConfirm(); f.r.render()
  assert.equal(f.dialog().props.open, false)
  assert.deepEqual(f.toasts.map(([kind]) => kind), ['success'])
})

test('useDatabaseConsole separates the drop result from the list refresh', async () => {
  const calls = []
  let refreshFails = true
  const tablesRead = { data: [], loaded: true, loading: false, error: null, refresh: async () => { calls.push('refresh'); if (refreshFails) throw new Error('刷新失败') } }
  const manager = { dbDropTable: async name => { calls.push(`drop:${name}`); return { success: true } } }
  let reads = 0
  const { useDatabaseConsole } = compile(hookSource, {
    '../../utils/console-client': { getConsoleTransport: () => manager },
    '../../hooks/use-console-read': { useConsoleRead: () => (reads++ % 2 === 0 ? { ...tablesRead, data: null } : tablesRead) },
  })
  const db = useDatabaseConsole()
  const outcome = await db.dropTable('users')
  assert.deepEqual(calls, ['drop:users', 'refresh'])
  assert.deepEqual(outcome.result, { success: true })
  assert.match(outcome.refreshError.message, /刷新失败/)

  refreshFails = false
  assert.equal((await db.dropTable('logs')).refreshError, null)

  manager.dbDropTable = async () => { throw new Error('无权限') }
  calls.length = 0
  await assert.rejects(db.dropTable('users'), /无权限/)
  assert.deepEqual(calls, [], 'the list is not refreshed when the drop fails')
})
