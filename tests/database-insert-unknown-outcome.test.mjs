// #64 `database-insert-unknown-outcome`: a db:insert that timed out (504 instance_timeout, requestOutcome 'unknown')
// was reported as 「保存失败…请重试」 with 保存 still enabled, so a second click inserted a duplicate row. Now an unknown
// outcome shows 「结果未知」, blocks 保存 / 删除 and offers only 「核对」, a db:select over what was just submitted.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileView, elements, expand, runtime, text, writeCheckModule } from './helpers/database-view-fixture.mjs'
import { databaseSaveError } from '../console-ui/src/pages/database/save-error.mjs'
import { insertCheckWhere, runWriteCheck, writeCheckCopy, writeCheckPlan } from '../console-ui/src/pages/database/write-check-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const relatedUrl = new URL('../console-ui/src/pages/database/related-table-view.tsx', import.meta.url)
const documentUrl = new URL('../console-ui/src/pages/database/document-collection-view.tsx', import.meta.url)
const relatedSource = await readFile(relatedUrl, 'utf8')
const documentSource = await readFile(documentUrl, 'utf8')

const timeout = () => Object.assign(new Error('The instance did not answer in time'), { details: { httpStatus: 504, serverCode: 'instance_timeout', requestOutcome: 'unknown' } })
const notDispatched = () => Object.assign(new Error('Instance unavailable'), { details: { httpStatus: 503, serverCode: 'instance_unavailable', requestOutcome: 'not-dispatched' } })

test('an unknown outcome is 结果未知, not 保存失败; a refused or undispatched write keeps its own reason', () => {
  const unknown = databaseSaveError(timeout())
  assert.equal(unknown.type, 'unknown')
  assert.match(unknown.text, /^结果未知/)
  assert.doesNotMatch(unknown.text, /保存失败|请检查详情后重试/)
  assert.equal(unknown.details, 'The instance did not answer in time')
  assert.equal(databaseSaveError(timeout(), 'en').text.startsWith('Outcome unknown'), true)
  const offline = databaseSaveError(notDispatched())
  assert.equal(offline.type, 'error')
  assert.match(offline.text, /请求没有发出/)
  const forbidden = databaseSaveError(Object.assign(new Error('Forbidden'), { details: { httpStatus: 403 } }))
  assert.equal(forbidden.text, '当前身份没有修改数据库的权限。')
  assert.equal(databaseSaveError(new Error('UNIQUE constraint failed: t.id')).text, '主键或唯一字段已存在，请修改后重试。')
})

test('核对 only reads: insert looks up the submitted plain fields, update compares, delete expects the row gone', async () => {
  assert.deepEqual(insertCheckWhere({ name: 'a', n: 1, ok: false, meta: { x: 1 }, gone: null, nan: NaN }), { name: 'a', n: 1, ok: false })
  assert.equal(insertCheckWhere({ meta: {} }), null)
  const reads = []
  const select = rows => async where => { reads.push(where); return { rows, total: rows.length } }
  assert.deepEqual(await runWriteCheck(writeCheckPlan('insert', { row: { name: 'a' } }), select([{ id: 7, name: 'a' }])), { verdict: 'applied', count: 1 })
  assert.deepEqual(await runWriteCheck(writeCheckPlan('insert', { row: { name: 'a' } }), select([])), { verdict: 'not-applied', count: 0 })
  assert.deepEqual(await runWriteCheck(writeCheckPlan('insert', { row: { meta: {} } }), select([{}])), { verdict: 'undetermined' })
  assert.equal((await runWriteCheck(writeCheckPlan('update', { row: { name: 'b' }, where: { id: 1 } }), select([{ id: 1, name: 'b' }]))).verdict, 'applied')
  assert.equal((await runWriteCheck(writeCheckPlan('update', { row: { name: 'b' }, where: { id: 1 } }), select([{ id: 1, name: 'a' }]))).verdict, 'not-applied')
  assert.equal((await runWriteCheck(writeCheckPlan('delete', { where: { id: 1 } }), select([]))).verdict, 'applied')
  assert.equal((await runWriteCheck(writeCheckPlan('delete', { where: { id: 1 } }), select([{ id: 1 }]))).verdict, 'not-applied')
  assert.deepEqual(reads, [{ name: 'a' }, { name: 'a' }, { id: 1 }, { id: 1 }, { id: 1 }, { id: 1 }], 'the undetermined plan reads nothing')
  await assert.rejects(runWriteCheck(writeCheckPlan('delete', { where: { id: 1 } }), async () => { throw timeout() }), 'a failed check leaves the outcome unknown')
})

test('every new string has English copy', () => {
  for (const kind of ['insert', 'update', 'delete']) for (const verdict of ['applied', 'not-applied', 'undetermined']) {
    assert.ok(Object.hasOwn(englishMessages, writeCheckCopy(kind, verdict)), writeCheckCopy(kind, verdict))
  }
  for (const key of ['核对', '正在核对…', '核对没有完成（{0}），结果仍未知。请稍后再核对。', '请求已发出，但没有收到可信的答复，可能已经写入。请先核对，不要直接重试。']) assert.ok(Object.hasOwn(englishMessages, key), key)
  assert.equal(translate('en', writeCheckCopy('insert', 'applied'), [1]), 'Check result: found 1 record matching what you submitted; the insert was written.')
})

// ---- the views, rendered on the hooks runtime ----

const definitions = { id: { type: 'integer', primary: true }, name: { type: 'text' }, score: { type: 'float' } }

function mocks(r) {
  return {
    react: { ...r.hooks },
    './write-check': writeCheckModule(r),
    './use-mutation': { useMutation: () => ({ busy: false, gate: { pending: false }, run: async fn => fn() }) },
    '../../components/toast': { useToast: () => ({ success() {}, error(message) { r.toasts.push(message) } }) },
    '@zhin.js/console-ui': { ConfirmDialog: 'confirm-dialog', ErrorAlert: 'error-alert', Button: 'button', Input: 'input', SelectField: 'select-field', Table: 'table', TableBody: 'tbody', TableCell: 'td', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr', Alert: 'div', AlertDescription: 'div', AlertTitle: 'h3', Card: 'article', CardContent: 'section', Dialog: 'dialog', DialogContent: 'div', DialogHeader: 'div', DialogTitle: 'h2', DialogFooter: 'div', DialogClose: 'div' },
    './json-field': { JsonField: 'json-field' },
    './RecordValueDisclosure': { RecordValueDisclosure: 'disclosure' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
}

/** A fake Host: every write and read is recorded; `replies[type]` is a value, an Error to throw, or a function. */
function host(rows, replies = {}) {
  const calls = []
  const answer = async (type, args, fallback) => {
    calls.push({ type, ...args })
    const reply = replies[type]
    if (typeof reply === 'function') { const value = reply(args); if (value instanceof Error) throw value; return value }
    if (reply instanceof Error) throw reply
    return reply ?? fallback
  }
  return {
    calls,
    writes: () => calls.filter(call => call.type !== 'db:select').map(call => call.type),
    select: (table, page = 1, pageSize = 10, where) => answer('db:select', { where }, (() => {
      const matched = rows.filter(row => !where || Object.entries(where).every(([key, value]) => row[key] === value))
      return { rows: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize }
    })()),
    insert: (table, row) => answer('db:insert', { row }),
    update: (table, row, where) => answer('db:update', { row, where }),
    remove: (table, where) => answer('db:delete', { where }),
  }
}

async function mount(View, source, props) {
  const r = runtime()
  r.toasts = []
  const exports = compileView(source, mocks(r), relatedUrl)
  r.mount(() => expand(exports[View](props)))
  await r.settle()
  const all = () => elements(r.value)
  const button = label => all().find(node => node.type === 'button' && text(node).trim() === label)
  return {
    r, all, button,
    text: () => text(r.value),
    dialog: () => all().find(node => node.type === 'dialog'),
    async click(label) { const target = button(label); assert.ok(target, `button ${label}`); await target.props.onClick?.(); await r.settle() },
  }
}

test('related table: an insert that times out shows 结果未知, keeps 保存 disabled, and 核对 settles it without a second insert', async () => {
  const server = host([], { 'db:insert': timeout() })
  const view = await mount('RelatedTableView', relatedSource, { tableName: 'messages', tableInfo: { name: 'messages', columns: definitions }, select: server.select, insert: server.insert, update: server.update, remove: server.remove, readOnly: false })
  await view.click('添加')
  for (const node of view.all().filter(node => node.type === 'json-field')) node.props.onChange(node.props.label === 'name' ? 'hello' : node.props.label === 'score' ? '2' : '')
  view.r.render()
  await view.click('保存')
  assert.deepEqual(server.writes(), ['db:insert'])
  assert.deepEqual(server.calls.find(call => call.type === 'db:insert').row, { name: 'hello', score: 2 })
  assert.match(view.text(), /结果未知/)
  assert.doesNotMatch(view.text(), /保存失败/)
  assert.equal(view.button('保存').props.disabled, true, '保存 is disabled')
  assert.equal(view.button('取消').props.disabled, true, 'the editor cannot be closed into a fresh 添加')
  assert.equal(view.dialog().props.open, true)
  view.dialog().props.onOpenChange(false); view.r.render()
  assert.equal(view.dialog().props.open, true, 'Escape / outside click do not close it either')
  // Even a click that reaches the handler does not send the write again.
  await view.button('保存').props.onClick(); await view.r.settle()
  assert.deepEqual(server.writes(), ['db:insert'], 'no second db:insert')
})

test('related table: 核对 reads what was submitted; found → 已写入 and closed, not found → 保存 is free again', async () => {
  for (const found of [true, false]) {
    const rows = []
    const server = host(rows, { 'db:insert': () => { if (found) rows.push({ id: 1, name: 'hello', score: 2 }); return timeout() } })
    const view = await mount('RelatedTableView', relatedSource, { tableName: 'messages', tableInfo: { name: 'messages', columns: definitions }, select: server.select, insert: server.insert, update: server.update, remove: server.remove, readOnly: false })
    await view.click('添加')
    for (const node of view.all().filter(node => node.type === 'json-field')) node.props.onChange(node.props.label === 'name' ? 'hello' : node.props.label === 'score' ? '2' : '')
    view.r.render()
    await view.click('保存')
    assert.match(view.text(), /结果未知/)
    const before = server.calls.length
    await view.click('核对')
    const check = server.calls.slice(before)[0]
    assert.deepEqual(check, { type: 'db:select', where: { name: 'hello', score: 2 } }, '核对 is a db:select over the submitted fields')
    assert.deepEqual(server.writes(), ['db:insert'], 'still one db:insert')
    if (found) {
      assert.equal(view.dialog().props.open, false, 'the editor closes')
      assert.match(view.text(), /这次添加已经写入/)
      assert.equal(view.button('添加').props.disabled, false)
    } else {
      assert.equal(view.dialog().props.open, true, 'the draft is kept')
      assert.match(view.text(), /没有找到这次添加的记录，可以重新保存/)
      assert.equal(view.button('保存').props.disabled, false, '保存 is free again')
      assert.doesNotMatch(view.text(), /结果未知/)
    }
  }
})

test('related table: an update or delete with an unknown outcome is held the same way', async () => {
  const rows = [{ id: 1, name: 'a', score: 1 }]
  const server = host(rows, { 'db:update': timeout(), 'db:delete': timeout() })
  const props = { tableName: 'messages', tableInfo: { name: 'messages', columns: definitions }, select: server.select, insert: server.insert, update: server.update, remove: server.remove, readOnly: false }
  let view = await mount('RelatedTableView', relatedSource, props)
  await view.all().find(node => node.type === 'button' && node.props['aria-label'] === '编辑记录').props.onClick(); await view.r.settle()
  view.all().find(node => node.type === 'json-field' && node.props.label === 'name').props.onChange('b'); view.r.render()
  await view.click('保存')
  await view.all().find(node => node.type === 'confirm-dialog' && node.props.title === '保存修改').props.onConfirm(); await view.r.settle()
  assert.deepEqual(server.writes(), ['db:update'])
  assert.match(view.text(), /结果未知/)
  assert.equal(view.button('保存').props.disabled, true)
  const before = server.calls.length
  await view.click('核对')
  assert.deepEqual(server.calls.slice(before)[0], { type: 'db:select', where: { id: 1 } })
  assert.match(view.text(), /记录还是修改前的内容/)

  view = await mount('RelatedTableView', relatedSource, props)
  await view.all().find(node => node.type === 'button' && node.props['aria-label'] === '删除记录').props.onClick(); await view.r.settle()
  await view.all().find(node => node.type === 'confirm-dialog' && node.props.title === '删除记录').props.onConfirm(); await view.r.settle()
  assert.deepEqual(server.writes(), ['db:update', 'db:delete'])
  assert.match(view.text(), /结果未知/)
  assert.deepEqual(view.r.toasts, [], 'no 删除失败 toast with the raw error')
  for (const node of view.all().filter(node => node.type === 'button' && ['删除记录', '编辑记录'].includes(node.props['aria-label']))) assert.equal(node.props.disabled, true)
  await view.all().find(node => node.type === 'button' && node.props['aria-label'] === '删除记录').props.onClick(); await view.r.settle()
  assert.deepEqual(server.writes(), ['db:update', 'db:delete'], 'no second db:delete')
  await view.click('核对')
  assert.match(view.text(), /记录仍在，这次删除没有执行/)
})

test('document collection: an insert that times out shows 结果未知 instead of the raw message and is never resent', async () => {
  const server = host([], { 'db:insert': timeout() })
  const view = await mount('DocumentCollectionView', documentSource, { tableName: 'notes', select: server.select, insert: server.insert, update: server.update, remove: server.remove, readOnly: false })
  await view.click('添加文档')
  view.all().find(node => node.type === 'textarea').props.onChange({ target: { value: '{"_id":"n1","title":"hi","meta":{"a":1}}' } }); view.r.render()
  await view.click('保存')
  assert.deepEqual(server.writes(), ['db:insert'])
  assert.match(view.text(), /结果未知/)
  const raw = 'The instance did not answer in time'
  const disclosed = view.all().filter(node => node.type === 'details').map(text).join('')
  assert.ok(disclosed.includes(raw), 'the raw text is under 技术详情')
  assert.equal(view.text().split(raw).length - 1, disclosed.split(raw).length - 1, 'and nowhere else')
  assert.equal(view.button('保存').props.disabled, true)
  assert.equal(view.button('取消').props.disabled, true)
  await view.button('保存').props.onClick(); await view.r.settle()
  assert.deepEqual(server.writes(), ['db:insert'], 'no second db:insert')
  const before = server.calls.length
  await view.click('核对')
  assert.deepEqual(server.calls.slice(before)[0], { type: 'db:select', where: { _id: 'n1', title: 'hi' } })
  assert.match(view.text(), /没有找到这次添加的记录/)
  assert.equal(view.button('保存').props.disabled, false)
})

test('document collection: a JSON mistake is a local error, not an unknown outcome', async () => {
  const server = host([])
  const view = await mount('DocumentCollectionView', documentSource, { tableName: 'notes', select: server.select, insert: server.insert, update: server.update, remove: server.remove, readOnly: false })
  await view.click('添加文档')
  view.all().find(node => node.type === 'textarea').props.onChange({ target: { value: '{ nope' } }); view.r.render()
  await view.click('保存')
  assert.deepEqual(server.writes(), [])
  assert.doesNotMatch(view.text(), /结果未知/)
  assert.equal(view.button('保存').props.disabled, false)
})
