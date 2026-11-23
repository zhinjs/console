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
const ddlSource = await readFile(new URL('../console-ui/src/pages/database/ddl-outcome.tsx', import.meta.url), 'utf8')
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

function fixture({ dropTable, loadTables = async () => [] }) {
  const r = runtime(), toasts = []
  const console = {
    info: { type: 'related', dialect: 'sqlite' },
    tables: [{ name: 'users', columns: { id: { type: 'integer', primary: true } } }, { name: 'logs', columns: {} }],
    loaded: true, loading: false, error: null,
    loadInfo: async () => {}, loadTables, dropTable,
  }
  const ui = { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tab', ConfirmDialog: 'confirm-dialog', Card: 'article', CardContent: 'section', Button: 'button', Badge: 'span', Skeleton: 'div', ScrollArea: 'div', ErrorAlert: 'aside', EmptyState: 'empty', PageHeader: 'page-header', Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description' }
  // The real 「结果未知」 hook and notice, on the same hook runtime as the page.
  const ddl = compile(ddlSource, { react: { ...r.hooks }, '@zhin.js/console-ui': ui, 'lucide-react': new Proxy({}, { get: () => 'i' }) })
  const mocks = {
    react: { ...r.hooks, useId: () => ':r0:' },
    './use-database-console': { useDatabaseConsole: () => console, databaseAdmin: {} },
    './sql-console': { SqlConsole: 'sql-console' },
    './schema-editor': { SchemaEditor: 'schema-editor', CreateTableEditor: 'create-table' },
    './resizable-split': { SplitHandle: 'split-handle', useSplitWidth: () => ({ width: 240, setWidth() {}, commit() {} }) },
    '@zhin.js/console-ui': ui,
    './ddl-outcome': { useDdlCheck: ddl.useDdlCheck, DdlCheckNotice: 'ddl-check-notice', DdlErrorDetails: 'ddl-error-details' },
    '../../components/StatusState': { StatusState: 'status-state' },
    '../../utils/read-error.mjs': { readErrorSummary: value => String(value) },
    '../../utils/console-access.mjs': { hasConsolePermission: () => true },
    '../../components/toast': { useToast: () => ({ success: m => toasts.push(['success', m]), warning: m => toasts.push(['warning', m]), error: m => toasts.push(['error', m]) }) },
    './constants': { DB_TYPE_LABELS: { related: '关系型数据库', document: '文档数据库', keyvalue: '键值数据库' }, DIALECT_LABELS: { sqlite: 'SQLite' } },
    './related-table-view': { RelatedTableView: 'related-view' },
    './document-collection-view': { DocumentCollectionView: 'document-view' },
    './kv-bucket-view': { KvBucketView: 'kv-view' },
    '../ops/load-state': { OpsLoadState: 'aside' },
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
    all,
    // The notice as it renders for the page's current check state.
    notice: () => ddl.DdlCheckNotice({ controller: all().find(node => node.type === 'ddl-check-notice').props.controller }),
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

test('a failed drop rejects so the dialog can show why and keep the table; the Host text goes to 技术详情', async () => {
  const f = fixture({ dropTable: async () => { throw new Error('FOREIGN KEY constraint failed') } })
  f.tableButton('users').props.onClick(); f.r.render()
  f.deleteButton().props.onClick(); f.r.render()
  await assert.rejects(f.dialog().props.onConfirm(), /表没有删除/)
  f.r.render()
  assert.equal(f.dialog().props.open, true)
  assert.ok(f.tableButton('users'))
  assert.equal(f.all().find(node => node.type === 'ddl-error-details').props.details, 'FOREIGN KEY constraint failed')
  assert.deepEqual(f.toasts, [])
})

// #64 `database-ddl-unknown-outcome`: a drop that timed out with requestOutcome 'unknown' showed the
// English message in the dialog and left 「删除」 clickable; a second click sent db:drop-table again.
const unknownDrop = () => Object.assign(new Error('The instance did not answer in time'), { code: 'instance_timeout', status: 504, requestOutcome: 'unknown' })

test('a drop with an unknown outcome closes the dialog, blocks dropping and offers only 「核对」', async () => {
  const dropped = []
  let fresh = [{ name: 'users' }, { name: 'logs' }]
  const f = fixture({ dropTable: async name => { dropped.push(name); throw unknownDrop() }, loadTables: async () => fresh })
  f.tableButton('users').props.onClick(); f.r.render()
  f.deleteButton().props.onClick(); f.r.render()
  await f.dialog().props.onConfirm()
  f.r.render()
  assert.deepEqual(dropped, ['users'])
  assert.equal(f.dialog().props.open, false, 'not left open with a live 「删除」')
  assert.equal(f.deleteButton().props.disabled, true, 'no second drop while the outcome is unknown')
  const notice = f.notice()
  assert.ok(notice && 'data-ddl-unknown' in notice.props, 'the page says the outcome is unknown')
  assert.match(text(notice), /可能已经删除/)
  assert.match(text(notice), /技术详情The instance did not answer in time/, 'the Host text only under 技术详情')
  // Even when the dialog is reopened (the disabled button bypassed) and confirmed, nothing is sent.
  f.deleteButton().props.onClick(); f.r.render()
  assert.equal(f.dialog().props.open, true)
  await f.dialog().props.onConfirm(); f.r.render()
  assert.deepEqual(dropped, ['users'], 'the held guard in onConfirm stops a second db:drop-table')
  f.dialog().props.onOpenChange(false); f.r.render()

  // 「核对」: the table is still there, so the drop did not run; dropping is offered again.
  const checkButton = () => elements(f.notice()).find(node => node.type === 'button' && node.props['data-action'] === 'ddl-check')
  checkButton().props.onClick(); await new Promise(resolve => setImmediate(resolve)); f.r.render()
  assert.ok('data-ddl-check-result' in f.notice().props)
  assert.match(text(f.notice()), /仍在表列表中，删除没有执行/)
  assert.equal(f.deleteButton().props.disabled, false)

  // Another unknown drop, and this time the table is gone: the check says the drop took effect.
  f.deleteButton().props.onClick(); f.r.render()
  await f.dialog().props.onConfirm(); f.r.render()
  fresh = [{ name: 'logs' }]
  checkButton().props.onClick()
  await new Promise(resolve => setImmediate(resolve)); f.r.render()
  assert.match(text(f.notice()), /已不在表列表中，删除已经生效/)
  assert.equal(f.deleteButton(), undefined, 'the dropped table is deselected')
  assert.deepEqual(dropped, ['users', 'users'])
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
    '../../utils/console-rpc': { requestConsole: async () => { throw new Error('not used') } },
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
