import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { resolveConsoleRpcPermission } from '@zhin.js/console-protocol'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

// #64 `sql-console-permission`: the protocol puts every SQL statement, read-only queries included, behind
// `ops.database.schema` (`db:query` and `db:execute`), yet the database page offered 「SQL 查询」 to any
// identity and told it 「只能执行单条只读语句」, so each run was refused.
const pageUrl = new URL('../console-ui/src/pages/database/database-page.tsx', import.meta.url)
const consoleUrl = new URL('../console-ui/src/pages/database/sql-console.tsx', import.meta.url)
const pageSource = await readFile(pageUrl, 'utf8')
const consoleSource = await readFile(consoleUrl, 'utf8')
const requireFromPage = createRequire(pageUrl)

const sqlPermission = (() => {
  const query = resolveConsoleRpcPermission('db:query'), execute = resolveConsoleRpcPermission('db:execute')
  assert.equal(query.kind, 'exact'); assert.equal(execute.kind, 'exact')
  assert.equal(query.permission, execute.permission, 'read and write SQL need the same permission')
  return query.permission
})()

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

function compile(source, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromPage(name), module.exports, module)
  return module.exports
}

function page(granted) {
  const r = runtime()
  const database = {
    info: { type: 'related', dialect: 'sqlite', capabilities: { sql: true, schema: true } },
    tables: [{ name: 'messages', columns: { id: { type: 'integer', primary: true } } }],
    loaded: true, loading: false, error: null,
    loadInfo: async () => {}, loadTables: async () => {}, dropTable: async () => ({}),
  }
  const mocks = {
    react: { ...r.hooks },
    './use-database-console': { useDatabaseConsole: () => database, databaseAdmin: {} },
    './sql-console': { SqlConsole: 'sql-console' },
    './schema-editor': { SchemaEditor: 'schema-editor', CreateTableEditor: 'create-table' },
    './resizable-split': { SplitHandle: 'split-handle', useSplitWidth: () => ({ width: 240, setWidth() {}, commit() {} }) },
    '@zhin.js/console-ui': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tab', ConfirmDialog: 'confirm-dialog', Card: 'article', CardContent: 'section', Button: 'button', Badge: 'span', Skeleton: 'div', ScrollArea: 'div', ErrorAlert: 'aside', EmptyState: 'empty', PageHeader: 'page-header' },
    '../../components/StatusState': { StatusState: 'status-state' },
    '../../utils/read-error.mjs': { readErrorSummary: value => String(value) },
    '../../utils/console-access.mjs': { hasConsolePermission: permission => granted.includes(permission) },
    '../../components/toast': { useToast: () => ({ success() {}, warning() {}, error() {} }) },
    './constants': { DB_TYPE_LABELS: { related: '关系型数据库' }, DIALECT_LABELS: { sqlite: 'SQLite' } },
    './related-table-view': { RelatedTableView: 'related-view' },
    './document-collection-view': { DocumentCollectionView: 'document-view' },
    './kv-bucket-view': { KvBucketView: 'kv-view' },
    '../ops/load-state': { OpsLoadState: 'aside' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
  r.mount(() => compile(pageSource, mocks).default())
  const all = () => elements(r.value)
  return {
    r,
    sqlEntry: () => all().find(node => node.type === 'button' && node.props['data-tool'] === 'sql'),
    sqlConsole: () => all().find(node => node.type === 'sql-console'),
    tableButton: name => all().find(node => node.type === 'button' && node.props['data-table'] === name),
  }
}

test('without the SQL permission there is no 「SQL 查询」 entry; browsing tables still works', () => {
  // Built-in viewer / admin: `ops.database.read` (and write) but not `ops.database.schema`.
  const f = page(['ops.database.read', 'ops.database.write'])
  assert.equal(f.sqlEntry(), undefined)
  assert.ok(f.tableButton('messages'), 'the table list is unaffected')
})

test('with the permission the protocol names for db:query the entry opens the SQL console', () => {
  const f = page(['ops.database.read', sqlPermission])
  const entry = f.sqlEntry()
  assert.ok(entry)
  entry.props.onClick(); f.r.render()
  const sql = f.sqlConsole()
  assert.ok(sql)
  assert.equal('canWrite' in sql.props, false, 'whoever reaches the console may run any statement the protocol allows')
})

test('the SQL console no longer promises read-only queries to identities that cannot run SQL', () => {
  assert.doesNotMatch(consoleSource, /只能执行单条只读语句/)
  assert.doesNotMatch(consoleSource, /当前身份只能执行只读语句/)
  assert.doesNotMatch(consoleSource, /!canWrite/)
})
