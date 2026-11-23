import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { kvCheckResult, kvWriteFailure } from '../console-ui/src/pages/database/kv-write-model.mjs'

// #64 `kv-write-error-raw`: a failed KV save showed the Host's English message (`err.message`) and left
// 「保存」 clickable even when the outcome was unknown; a failed delete toasted the raw message. A retry of
// a new key that had in fact been written was then refused as 「键已存在」, with no sign the first try
// had worked.
const CJK = /[一-鿿]/u
const unknown = () => Object.assign(new Error('The instance did not answer in time'), { code: 'instance_timeout', status: 504, requestOutcome: 'unknown' })

test('failures are told apart in the UI language; the Host text is kept for 技术详情', () => {
  for (const action of ['set', 'delete']) {
    const held = kvWriteFailure(unknown(), action)
    assert.equal(held.unknown, true)
    assert.equal(held.details, 'The instance did not answer in time')
    assert.match(held.text, /不要直接重试/)
    assert.doesNotMatch(kvWriteFailure(unknown(), action, 'en').text, CJK)
    const failed = kvWriteFailure(new Error('SQLITE_READONLY: attempt to write a readonly database'), action)
    assert.equal(failed.unknown, false)
    assert.doesNotMatch(failed.text, /SQLITE/)
    assert.equal(failed.details, 'SQLITE_READONLY: attempt to write a readonly database')
    assert.match(kvWriteFailure(Object.assign(new Error('Forbidden'), { code: 'forbidden', status: 403 }), action).text, /没有修改数据库的权限/)
  }
})

test('「核对」 decides from the bucket: the saved value is there, or the deleted key is gone', () => {
  const entries = [{ key: 'greeting', value: { text: 'hi' } }]
  assert.equal(kvCheckResult(entries, { action: 'set', key: 'greeting', value: { text: 'hi' } }).applied, true)
  assert.equal(kvCheckResult(entries, { action: 'set', key: 'greeting', value: { text: 'hello' } }).applied, false)
  assert.equal(kvCheckResult([], { action: 'set', key: 'greeting', value: 1 }).applied, false)
  assert.equal(kvCheckResult(entries, { action: 'delete', key: 'greeting' }).applied, false)
  assert.equal(kvCheckResult([], { action: 'delete', key: 'greeting' }).applied, true)
  assert.throws(() => kvCheckResult(undefined, { action: 'delete', key: 'greeting' }), 'an unreadable bucket keeps the hold')
  assert.doesNotMatch(kvCheckResult([], { action: 'delete', key: 'k' }, 'en').text, CJK)
})

// The view itself, on a tiny hook runtime, with the real 「结果未知」 hook.
const viewUrl = new URL('../console-ui/src/pages/database/kv-bucket-view.tsx', import.meta.url)
const requireFromView = createRequire(viewUrl)
const [viewSource, ddlSource] = await Promise.all([readFile(viewUrl, 'utf8'), readFile(new URL('../console-ui/src/pages/database/ddl-outcome.tsx', import.meta.url), 'utf8')])
function compile(source, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromView(name), module.exports, module)
  return module.exports
}
const elements = value => value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] : []
const text = value => value == null || typeof value === 'boolean' ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children)
const settle = () => new Promise(resolve => setImmediate(resolve))

function fixture({ kvSet, kvDelete, entries = [{ key: 'greeting', value: 'hi' }] }) {
  const slots = []; let cursor = 0, dirty = false, value
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; dirty = true } }] },
    useCallback(fn) { cursor++; return fn }, useMemo(fn) { cursor++; return fn() },
    // Each effect runs once, after the render that first saw it (the initial load).
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; queueMicrotask(fn) } },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
  }
  const ui = new Proxy({ Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description', Button: 'button', ConfirmDialog: 'confirm-dialog', Dialog: 'dialog', DialogContent: 'dialog-content', DialogFooter: 'dialog-footer', DialogHeader: 'dialog-header', DialogTitle: 'dialog-title', DialogClose: 'dialog-close', Input: 'input' }, { get: (target, name) => target[name] ?? String(name) })
  const icons = new Proxy({}, { get: () => 'i' })
  const ddl = compile(ddlSource, { react: hooks, '@zhin.js/console-ui': ui, 'lucide-react': icons })
  const toasts = []
  let current = entries
  const view = compile(viewSource, {
    react: hooks, '@zhin.js/console-ui': ui, 'lucide-react': icons,
    './ddl-outcome': { useDdlCheck: ddl.useDdlCheck, DdlCheckNotice: 'ddl-check-notice' },
    './RecordValueDisclosure': { RecordValueDisclosure: 'record-value' },
    './use-mutation': { useMutation: () => ({ busy: false, gate: { pending: false }, run: fn => fn() }) },
    '../../components/toast': { useToast: () => ({ success: message => toasts.push(message), error: message => toasts.push(message) }) },
  })
  const props = { tableName: 'cache', kvGet: async () => ({}), kvSet, kvDelete, kvEntries: async () => ({ entries: current }), readOnly: false }
  const render = () => { let count = 0; do { assert.ok(++count < 30); dirty = false; cursor = 0; value = view.KvBucketView(props) } while (dirty); return value }
  render()
  const all = () => elements(value)
  const ready = (async () => { await settle(); render() })()
  return {
    ready, render, toasts, setEntries: next => { current = next },
    all,
    notices: () => all().filter(node => node.type === 'ddl-check-notice'),
    save: () => all().find(node => node.type === 'button' && text(node).includes('保存')),
    add: () => all().find(node => node.type === 'button' && text(node).includes('添加键值')),
    dialog: () => all().find(node => node.type === 'confirm-dialog'),
    deleteButton: () => all().find(node => node.type === 'button' && node.props['aria-label'] === '删除记录'),
    input: () => all().find(node => node.type === 'input'),
    textarea: () => all().find(node => node.type === 'textarea'),
  }
}

test('a save with an unknown outcome locks every write and offers only 「核对」; the check finds it written', async () => {
  const sets = []
  const f = fixture({ kvSet: async (table, key, value) => { sets.push([key, value]); throw unknown() }, kvDelete: async () => {} })
  await f.ready
  f.add().props.onClick(); f.render()
  f.input().props.onChange({ target: { value: 'token' } }); f.textarea().props.onChange({ target: { value: '"abc"' } }); f.render()
  await f.save().props.onClick(); await settle(); f.render()
  assert.deepEqual(sets, [['token', 'abc']])
  assert.equal(f.save().props.disabled, true, 'no second db:kv:set while the outcome is unknown')
  assert.equal(f.deleteButton().props.disabled, true, 'deleting is locked too')
  const controller = f.notices()[0].props.controller
  assert.ok(controller.held, 'the 「结果未知」 notice is shown')
  assert.match(controller.held.text, /可能已经写入/)
  assert.equal(controller.held.details, 'The instance did not answer in time', 'the Host text only under 技术详情')
  assert.doesNotMatch(text(f.all().find(node => node.props?.role === 'alert') ?? ''), /did not answer/, 'no raw English as the message')
  // Fired anyway (a stale click): nothing is sent.
  await f.save().props.onClick(); assert.equal(sets.length, 1)

  // The first try had landed: the check says so and closes the editor, instead of 「键已存在」 on a retry.
  f.setEntries([{ key: 'greeting', value: 'hi' }, { key: 'token', value: 'abc' }])
  await controller.check(); await settle(); f.render()
  assert.equal(f.notices()[0].props.controller.held, null)
  assert.match(f.notices()[0].props.controller.result.text, /已是要保存的值，保存已经生效/)
  assert.equal(f.all().find(node => node.type === 'dialog').props.open, false, 'the editor is closed')
  assert.equal(f.deleteButton().props.disabled, false)
})

test('a delete with an unknown outcome is held for 「核对」; a plain failure says why, the Host text in 技术详情', async () => {
  const deletes = []
  const f = fixture({ kvSet: async () => {}, kvDelete: async (table, key) => { deletes.push(key); throw unknown() } })
  await f.ready
  f.deleteButton().props.onClick(); f.render()
  await f.dialog().props.onConfirm(); await settle(); f.render()
  assert.deepEqual(deletes, ['greeting'])
  assert.equal(f.toasts.length, 0, 'no raw toast')
  assert.equal(f.deleteButton().props.disabled, true)
  await f.notices()[0].props.controller.check(); await settle(); f.render()
  assert.match(f.notices()[0].props.controller.result.text, /仍然存在，删除没有执行/)
  assert.equal(f.deleteButton().props.disabled, false)

  const g = fixture({ kvSet: async () => {}, kvDelete: async () => { throw new Error('SQLITE_BUSY: database is locked') } })
  await g.ready
  g.deleteButton().props.onClick(); g.render()
  await g.dialog().props.onConfirm(); await settle(); g.render()
  const alert = g.all().find(node => node.type === 'alert')
  assert.match(text(alert), /键没有删除/)
  assert.match(text(alert), /技术详情SQLITE_BUSY: database is locked/)
  assert.deepEqual(g.toasts, [])
})
