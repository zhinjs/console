import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import {
  filterColumnKind, filterOperators, filterableColumns, relatedFilterWhere, documentFilterWhere, sortCurrentPageRows,
} from '../console-ui/src/pages/database/record-query.mjs'

const relatedUrl = new URL('../console-ui/src/pages/database/related-table-view.tsx', import.meta.url)
const documentUrl = new URL('../console-ui/src/pages/database/document-collection-view.tsx', import.meta.url)
const relatedSource = await readFile(relatedUrl, 'utf8')
const documentSource = await readFile(documentUrl, 'utf8')
const requireFromPage = createRequire(relatedUrl)

const definitions = {
  id: { type: 'integer', primary: true },
  name: { type: 'text' },
  score: { type: 'float' },
  active: { type: 'boolean' },
  meta: { type: 'json' },
  created: { type: 'date' },
}

test('columns are searchable by their declared type; json and date columns are not offered', () => {
  assert.equal(filterColumnKind(definitions.name), 'text')
  assert.equal(filterColumnKind(definitions.id), 'integer')
  assert.equal(filterColumnKind({ type: 'bigint' }), 'integer')
  assert.equal(filterColumnKind(definitions.meta), null)
  assert.equal(filterColumnKind(definitions.created), null)
  assert.equal(filterColumnKind(undefined, 'x'), 'text', 'untyped columns fall back to the sample value')
  assert.equal(filterColumnKind(undefined, { a: 1 }), null)
  assert.deepEqual(filterOperators('text'), ['contains', 'eq'])
  assert.deepEqual(filterOperators('integer'), ['eq'])
  assert.deepEqual(filterOperators(null), [])
  assert.deepEqual(filterableColumns(Object.keys(definitions), definitions).map(column => column.name), ['id', 'name', 'score', 'active'])
})

test('related filters become the where Host db:select applies to the whole table', () => {
  assert.deepEqual(relatedFilterWhere({ column: 'name', operator: 'contains', value: 'ali' }, definitions).where, { name: { $like: '%ali%' } })
  assert.deepEqual(relatedFilterWhere({ column: 'name', operator: 'eq', value: ' Alice ' }, definitions).where, { name: ' Alice ' }, 'text equality keeps the exact text')
  assert.deepEqual(relatedFilterWhere({ column: 'id', operator: 'eq', value: ' 42 ' }, definitions).where, { id: 42 })
  assert.deepEqual(relatedFilterWhere({ column: 'id', operator: 'contains', value: '42' }, definitions), { where: { id: 42 }, operator: 'eq' }, 'numbers have no contains')
  assert.deepEqual(relatedFilterWhere({ column: 'id', operator: 'eq', value: '9007199254740993' }, definitions).where, { id: '9007199254740993' }, 'unsafe integers are not rounded')
  assert.deepEqual(relatedFilterWhere({ column: 'score', operator: 'eq', value: '1.5' }, definitions).where, { score: 1.5 })
  assert.deepEqual(relatedFilterWhere({ column: 'active', operator: 'eq', value: 'TRUE' }, definitions).where, { active: true })
  assert.deepEqual(relatedFilterWhere({ column: 'active', operator: 'eq', value: '0' }, definitions).where, { active: false })
  assert.match(relatedFilterWhere({ column: 'id', operator: 'eq', value: 'abc' }, definitions).error, /整数/)
  assert.match(relatedFilterWhere({ column: 'score', operator: 'eq', value: 'x' }, definitions).error, /数字/)
  assert.match(relatedFilterWhere({ column: 'active', operator: 'eq', value: 'yes' }, definitions).error, /true/)
  assert.match(relatedFilterWhere({ column: 'name', operator: 'contains', value: '  ' }, definitions).error, /输入要查找的值/)
  assert.match(relatedFilterWhere({ column: 'meta', operator: 'eq', value: '{}' }, definitions).error, /不支持/)
  assert.match(relatedFilterWhere({ column: '', operator: 'eq', value: '1' }, definitions).error, /选择/)
  assert.match(relatedFilterWhere({ column: 'id', operator: 'eq', value: 'x' }, definitions, undefined, 'en').error, /integer/)
})

test('document filters are equality on one field with the value read as JSON when it parses', () => {
  assert.deepEqual(documentFilterWhere({ field: ' status ', value: 'open' }).where, { status: 'open' })
  assert.deepEqual(documentFilterWhere({ field: 'count', value: '42' }).where, { count: 42 })
  assert.deepEqual(documentFilterWhere({ field: 'code', value: '"42"' }).where, { code: '42' })
  assert.deepEqual(documentFilterWhere({ field: 'done', value: 'false' }).where, { done: false })
  assert.deepEqual(documentFilterWhere({ field: 'owner', value: 'null' }).where, { owner: null })
  assert.match(documentFilterWhere({ field: '', value: '1' }).error, /字段名/)
  assert.match(documentFilterWhere({ field: '$where', value: '1' }).error, /\$/)
  assert.match(documentFilterWhere({ field: 'a', value: '{"$gt":1}' }).error, /只能/)
  assert.match(documentFilterWhere({ field: 'a', value: '' }).error, /输入要查找的值/)
})

test('page sorting only reorders the rows it is given', () => {
  const rows = [{ n: 'b10' }, { n: null }, { n: 'b2' }, { n: 'a' }]
  assert.deepEqual(sortCurrentPageRows(rows, 'n', 'asc').map(row => row.n), ['a', 'b2', 'b10', null])
  assert.deepEqual(sortCurrentPageRows(rows, 'n', 'desc').map(row => row.n), ['b10', 'b2', 'a', null])
  assert.equal(sortCurrentPageRows(rows, null, 'asc'), rows)
  assert.deepEqual(rows.map(row => row.n), ['b10', null, 'b2', 'a'], 'the loaded page is not mutated')
})

// Minimal hooks runtime that runs effects when their deps change, so the views load like in React.
function runtime() {
  const slots = []; let cursor = 0, dirty = false, render, value, pending = []
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; dirty = true } }]
    },
    useMemo(fn, deps) {
      const i = cursor++, old = slots[i]
      if (old && deps.every((item, k) => Object.is(item, old.deps[k]))) return old.value
      slots[i] = { deps, value: fn() }; return slots[i].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i]
      if (old && deps.every((item, k) => Object.is(item, old.deps[k]))) return
      slots[i] = { deps }; pending.push(fn)
    },
  }
  const api = {
    hooks,
    mount(fn) { render = fn; api.render(); return api },
    render() {
      let count = 0
      do {
        assert.ok(++count < 30, 'render must settle')
        do { dirty = false; cursor = 0; value = render() } while (dirty)
        const effects = pending; pending = []
        for (const effect of effects) effect()
      } while (dirty || pending.length)
      return value
    },
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); api.render() } },
    get value() { return value },
  }
  return api
}

const elements = value => value && typeof value === 'object'
  ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)]
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

function sharedMocks(r) {
  return {
    react: { ...r.hooks },
    './use-mutation': { useMutation: () => ({ busy: false, gate: { pending: false }, run: async fn => fn() }) },
    '../../components/toast': { useToast: () => ({ success() {}, error() {} }) },
    '../../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../../components/error-alert': { ErrorAlert: 'error-alert' },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select-field' },
    '../../components/ui/table': { Table: 'table', TableBody: 'tbody', TableCell: 'td', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr' },
    '../../components/ui/alert': { Alert: 'div', AlertDescription: 'div' },
    '../../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../../components/ui/dialog': { Dialog: 'dialog', DialogContent: 'div', DialogHeader: 'div', DialogTitle: 'h2', DialogFooter: 'div', DialogClose: 'div' },
    './json-field': { JsonField: 'json-field' },
    './RecordValueDisclosure': { RecordValueDisclosure: 'disclosure' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
}

function serverTable(total) {
  const calls = []
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1, name: `user${i + 1}`, score: i / 2, active: i % 2 === 0, meta: {}, created: '2026-01-01' }))
  const select = async (table, page = 1, pageSize = 10, where) => {
    calls.push({ table, page, pageSize, where })
    let matched = rows
    if (where?.name?.$like) { const needle = where.name.$like.slice(1, -1); matched = rows.filter(row => row.name.includes(needle)) }
    else if (where && 'id' in where) matched = rows.filter(row => row.id === where.id)
    return { rows: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize }
  }
  return { calls, select }
}

async function relatedFixture(total = 120) {
  const r = runtime(), server = serverTable(total)
  const { RelatedTableView } = compile(relatedSource, sharedMocks(r))
  const props = { tableName: 'users', tableInfo: { name: 'users', columns: definitions }, select: server.select, insert: async () => {}, update: async () => {}, remove: async () => {}, readOnly: true }
  r.mount(() => RelatedTableView(props))
  await r.settle()
  const all = () => elements(r.value)
  const find = predicate => all().find(predicate)
  const api = {
    r, server, all,
    form: () => find(node => node.type === 'form' && node.props.role === 'search'),
    select: label => find(node => node.type === 'select-field' && node.props['aria-label'] === label),
    valueInput: () => find(node => node.type === 'input' && node.props['aria-label'] === '查找的值'),
    clear: () => find(node => node.props?.['data-action'] === 'clear-filter'),
    next: () => find(node => node.type === 'button' && node.props['aria-label'] === '下一页'),
    sortButton: column => find(node => node.type === 'button' && String(node.props['aria-label'] ?? '').startsWith(`按 ${column} `)),
    text: () => text(r.value),
    rowIds: () => all().filter(node => node.type === 'tr').slice(1).map(row => text([row.props.children].flat(Infinity)[0])),
    async type(value) { api.valueInput().props.onChange({ target: { value } }); r.render() },
    async submit() { let prevented = false; api.form().props.onSubmit({ preventDefault: () => { prevented = true } }); assert.ok(prevented, 'the search form does not navigate'); await r.settle() },
  }
  return api
}

test('a related table search queries the whole table through Host where and returns to page 1', async () => {
  const f = await relatedFixture()
  assert.deepEqual(f.server.calls.at(-1), { table: 'users', page: 1, pageSize: 50, where: undefined })
  assert.deepEqual(f.select('查找的列').props.options.map(option => option.value), ['id', 'name', 'score', 'active', 'meta', 'created'], 'every column can be filtered (json/date by null only)')

  f.next().props.onClick(); await f.r.settle()
  f.next().props.onClick(); await f.r.settle()
  assert.equal(f.server.calls.at(-1).page, 3)

  f.select('查找的列').props.onValueChange('name'); f.r.render()
  assert.deepEqual(f.select('查找方式').props.options.map(option => option.value), ['contains', 'eq', 'ne', 'gt', 'lt', 'null', 'notnull'])
  await f.type('user11')
  await f.submit()
  assert.deepEqual(f.server.calls.at(-1), { table: 'users', page: 1, pageSize: 50, where: { name: { $like: '%user11%' } } }, 'the condition goes to Host and the page resets')
  assert.deepEqual(f.rowIds(), ['11', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119'], 'matches from every page are found')
  assert.match(f.text(), /共 11 条 · 第 1\/1 页 · 已筛选/)
  assert.match(f.text(), /全表查找：name 包含 “user11”/)

  f.clear().props.onClick(); await f.r.settle()
  assert.deepEqual(f.server.calls.at(-1), { table: 'users', page: 1, pageSize: 50, where: undefined }, 'clearing removes the condition')
  assert.equal(f.clear(), undefined)
  assert.equal(f.valueInput().props.value, '')
  assert.doesNotMatch(f.text(), /已筛选/)
})

test('a typed equality search sends a typed value and invalid input is reported without a request', async () => {
  const f = await relatedFixture()
  const before = f.server.calls.length
  assert.deepEqual(f.select('查找方式').props.options.map(option => option.value), ['eq', 'ne', 'gt', 'lt', 'null', 'notnull'], 'integer columns have no contains')
  await f.type('abc')
  await f.submit()
  assert.equal(f.server.calls.length, before, 'invalid input is not sent')
  assert.match(f.text(), /请输入整数/)
  await f.type('42')
  assert.doesNotMatch(f.text(), /请输入整数/, 'editing clears the error')
  await f.submit()
  assert.deepEqual(f.server.calls.at(-1).where, { id: 42 })
  assert.deepEqual(f.rowIds(), ['42'])

  await f.type('999')
  await f.submit()
  assert.match(f.text(), /没有符合条件的记录/)
  assert.ok(f.clear(), 'the condition can still be cleared when nothing matches')
})

test('column sorting does not pretend to sort the whole table', async () => {
  const f = await relatedFixture()
  const before = f.server.calls.length
  f.sortButton('id').props.onClick(); f.r.render()
  f.sortButton('id').props.onClick(); f.r.render()
  assert.equal(f.server.calls.length, before, 'Host has no ordering parameter, so sorting sends no request')
  assert.equal(f.rowIds()[0], '50', 'descending only covers the 50 loaded rows, not record 120')
  assert.match(f.text(), /本页排序/)
  assert.match(f.text(), /排序只作用于当前页已加载的 50 条记录，Host 暂不支持全表排序。/)
  const cancel = f.all().find(node => node.type === 'button' && text(node) === '取消排序')
  cancel.props.onClick(); f.r.render()
  assert.doesNotMatch(f.text(), /排序只作用于当前页/)
  assert.equal(f.rowIds()[0], '1')
})

test('a document collection search sends an equality where, resets the page and can be cleared', async () => {
  const r = runtime(), calls = []
  const select = async (table, page = 1, pageSize = 10, where) => {
    calls.push({ page, where })
    return { rows: where ? [{ _id: 'a', status: 'open' }] : [{ _id: 'a' }, { _id: 'b' }], total: where ? 1 : 60, page, pageSize }
  }
  const { DocumentCollectionView } = compile(documentSource, {
    ...sharedMocks(r),
    './record-value-preview.mjs': { valuePreview: () => 'preview', fullValueText: value => String(value) },
  })
  r.mount(() => DocumentCollectionView({ tableName: 'tickets', select, insert: async () => {}, update: async () => {}, remove: async () => {}, readOnly: true }))
  await r.settle()
  const all = () => elements(r.value)
  const input = label => all().find(node => node.type === 'input' && node.props['aria-label'] === label)
  const form = () => all().find(node => node.type === 'form')
  assert.deepEqual(calls.at(-1), { page: 1, where: undefined })

  all().find(node => node.type === 'button' && node.props['aria-label'] === '下一页').props.onClick(); await r.settle()
  assert.equal(calls.at(-1).page, 2)

  form().props.onSubmit({ preventDefault() {} }); r.render()
  assert.match(text(r.value), /请输入字段名/)
  input('字段名').props.onChange({ target: { value: 'status' } }); r.render()
  input('查找的值').props.onChange({ target: { value: 'open' } }); r.render()
  form().props.onSubmit({ preventDefault() {} }); await r.settle()
  assert.deepEqual(calls.at(-1), { page: 1, where: { status: 'open' } })
  assert.match(text(r.value), /已筛选/)
  assert.match(text(r.value), /全表查找：status 等于 “open”/)

  all().find(node => node.props?.['data-action'] === 'clear-filter').props.onClick(); await r.settle()
  assert.deepEqual(calls.at(-1), { page: 1, where: undefined })
  assert.doesNotMatch(text(r.value), /已筛选/)
})

// ---- Server-side sort, per-column filters, masking and row-change confirmation ----

function orderedServer(total) {
  const calls = []
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1, name: `user${i + 1}`, score: i % 3 === 0 ? null : i, active: true, api_token: `tok-${i + 1}` }))
  const select = async (table, page = 1, pageSize = 10, where, orderBy) => {
    calls.push({ page, pageSize, where, orderBy })
    let matched = rows
    if (where?.score && typeof where.score === 'object' && '$eq' in where.score) matched = rows.filter(row => row.score === null)
    if (where && typeof where.id === 'number') matched = rows.filter(row => row.id === where.id)
    if (orderBy) matched = [...matched].sort((a, b) => (a[orderBy.column] < b[orderBy.column] ? -1 : 1) * (orderBy.direction === 'desc' ? -1 : 1))
    return { rows: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize }
  }
  return { calls, rows, select }
}

async function serverSortFixture({ readOnly = true } = {}) {
  const r = runtime(), server = orderedServer(120), updates = []
  const { RelatedTableView } = compile(relatedSource, sharedMocks(r))
  const columns = { id: { type: 'integer', primary: true }, name: { type: 'text' }, score: { type: 'integer', nullable: true }, active: { type: 'boolean' }, api_token: { type: 'text' } }
  const props = {
    tableName: 'users', tableInfo: { name: 'users', columns }, select: server.select, insert: async () => {},
    update: async (table, row, where) => { updates.push({ row, where }); const target = server.rows.find(item => item.id === where.id); Object.assign(target, row); return { affected: 1 } },
    remove: async () => {}, readOnly, serverSort: true,
  }
  r.mount(() => RelatedTableView(props))
  await r.settle()
  const all = () => elements(r.value)
  return {
    r, server, updates, all,
    sortButton: column => all().find(node => node.type === 'button' && node.props['data-sort-column'] === column),
    rowIds: () => all().filter(node => node.type === 'tr').slice(1).map(row => text([row.props.children].flat(Infinity)[0])),
    text: () => text(r.value),
  }
}

test('with a Host that sorts, a header click cycles ascending → descending → none across the whole table', async () => {
  const f = await serverSortFixture()
  assert.equal(f.server.calls.at(-1).orderBy, undefined)
  f.sortButton('id').props.onClick(); await f.r.settle()
  assert.deepEqual(f.server.calls.at(-1).orderBy, { column: 'id', direction: 'asc' })
  f.sortButton('id').props.onClick(); await f.r.settle()
  assert.deepEqual(f.server.calls.at(-1), { page: 1, pageSize: 50, where: undefined, orderBy: { column: 'id', direction: 'desc' } })
  assert.equal(f.rowIds()[0], '120', 'descending starts at the last record of the table, not of the page')
  assert.doesNotMatch(f.text(), /本页排序|排序只作用于当前页/)
  assert.match(f.text(), /按 id 降序/)
  f.sortButton('id').props.onClick(); await f.r.settle()
  assert.equal(f.server.calls.at(-1).orderBy, undefined, 'the third click removes the order')
  const header = f.all().find(node => node.type === 'th')
  assert.equal(header.props['aria-sort'], 'none')
})

test('null filters need no value, and sensitive columns are masked until a cell is revealed', async () => {
  const f = await serverSortFixture()
  const select = label => f.all().find(node => node.type === 'select-field' && node.props['aria-label'] === label)
  f.all().find(node => node.props?.['data-filter-column'] === 'score').props.onClick(); f.r.render()
  assert.equal(select('查找的列').props.value, 'score', 'the header filter button picks its column')
  select('查找方式').props.onValueChange('null'); f.r.render()
  const input = f.all().find(node => node.type === 'input' && node.props['aria-label'] === '查找的值')
  assert.equal(input.props.disabled, true)
  f.all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.r.settle()
  assert.deepEqual(f.server.calls.at(-1).where, { score: { $eq: null } })
  assert.match(f.text(), /全表查找：score 为空/)
  assert.equal(f.all().find(node => node.props?.['data-filter-column'] === 'score').props['aria-pressed'], true)

  const masked = () => f.all().filter(node => node.props?.['data-masked'] === 'true')
  const before = masked().length
  assert.ok(before > 0, 'api_token cells are masked')
  assert.doesNotMatch(f.text(), /tok-1\b/)
  masked()[0].props.onClick(); f.r.render()
  assert.equal(masked().length, before - 1, 'only the clicked cell is revealed')
  assert.match(f.text(), /tok-1/)
  f.all().find(node => node.props?.['data-action'] === 'clear-filter').props.onClick(); await f.r.settle()
  assert.equal(masked().length, f.rowIds().length, 'a new read masks every cell again')
})

test('saving an edit asks with the matching row count and keeps the row where it was', async () => {
  const f = await serverSortFixture({ readOnly: false })
  f.sortButton('name').props.onClick(); await f.r.settle()
  const ids = f.rowIds()
  const edit = f.all().filter(node => node.type === 'button' && node.props['aria-label'] === '编辑记录')[1]
  edit.props.onClick(); f.r.render()
  const nameField = f.all().find(node => node.type === 'json-field' && node.props.label === 'name')
  nameField.props.onChange('zzz-last'); f.r.render()
  const save = f.all().find(node => node.type === 'button' && text(node).includes('保存'))
  await save.props.onClick(); await f.r.settle()
  const confirm = f.all().find(node => node.type === 'confirm-dialog' && node.props.title === '保存修改')
  assert.equal(confirm.props.open, true)
  assert.match(confirm.props.description, /将影响 1 行/)
  assert.equal(f.updates.length, 0, 'nothing is written before the confirmation')
  await confirm.props.onConfirm(); await f.r.settle()
  assert.equal(f.updates.length, 1)
  assert.deepEqual(f.rowIds(), ids, 'the edited row did not jump to its new sorted position')
  assert.match(f.text(), /zzz-last/)
  assert.match(f.text(), /已在原位置显示修改后的记录/)
})
