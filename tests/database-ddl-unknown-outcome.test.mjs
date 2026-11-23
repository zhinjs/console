import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { alterCheckResult, createCheckResult, ddlFailure, dropCheckResult } from '../console-ui/src/pages/database/ddl-outcome-model.mjs'

// #64 `database-ddl-unknown-outcome`: 「删除表」 and 「应用结构修改」 threw the Host error straight into
// ConfirmDialog. On an unknown outcome the dialog showed only the English text and its 「删除 / 应用」
// stayed clickable, so a second click sent the DDL again. (The page side of the drop is covered in
// database-drop-table.test.mjs.)
const CJK = /[一-鿿]/u
const unknown = () => Object.assign(new Error('The instance did not answer in time'), { code: 'instance_timeout', status: 504, requestOutcome: 'unknown' })

test('an unknown outcome is told apart from a plain failure, in the UI language, with the Host text kept', () => {
  for (const action of ['drop', 'schema']) {
    const held = ddlFailure(unknown(), action)
    assert.equal(held.unknown, true, action)
    assert.equal(held.details, 'The instance did not answer in time')
    assert.match(held.text, /可能已经|不要再次/)
    assert.doesNotMatch(ddlFailure(unknown(), action, 'en').text, CJK, `${action} is translated`)
    const failed = ddlFailure(new Error('FOREIGN KEY constraint failed'), action)
    assert.equal(failed.unknown, false)
    assert.equal(failed.details, 'FOREIGN KEY constraint failed')
    assert.doesNotMatch(failed.text, /FOREIGN KEY/, 'the Host text is not the message')
  }
  assert.match(ddlFailure(Object.assign(new Error('Forbidden'), { code: 'forbidden', status: 403 }), 'schema').text, /没有修改表结构的权限/)
  // A request that was never sent is not unknown: retrying is safe.
  assert.equal(ddlFailure(Object.assign(new Error('instance stopped'), { code: 'instance_unavailable', status: 503, requestOutcome: 'not-dispatched' }), 'drop').unknown, false)
})

test('「核对」 reads the outcome from the fresh table list (drop, create) or re-reads the structure (alter)', () => {
  assert.equal(dropCheckResult([{ name: 'users' }], 'users').applied, false)
  assert.equal(dropCheckResult([{ name: 'logs' }], 'users').applied, true)
  assert.equal(createCheckResult([{ name: 'users' }], 'users').applied, true)
  assert.equal(createCheckResult([], 'users').applied, false)
  assert.equal(alterCheckResult().applied, null)
  // A list that cannot decide (a Host answering without one) fails the check, so the hold stays.
  assert.throws(() => dropCheckResult({}, 'users'))
  assert.throws(() => createCheckResult(undefined, 'users'))
  for (const result of [dropCheckResult([], 'x', 'en'), createCheckResult([], 'x', 'en'), alterCheckResult('en')]) assert.doesNotMatch(result.text, CJK)
})

// useSchemaApply (schema-editor.tsx) on a tiny hook runtime.
const editorUrl = new URL('../console-ui/src/pages/database/schema-editor.tsx', import.meta.url)
const requireFromEditor = createRequire(editorUrl)
const [editorSource, ddlSource] = await Promise.all([readFile(editorUrl, 'utf8'), readFile(new URL('../console-ui/src/pages/database/ddl-outcome.tsx', import.meta.url), 'utf8')])
function compile(source, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromEditor(name), module.exports, module)
  return module.exports
}
function hookRuntime() {
  const slots = []; let cursor = 0
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useCallback: fn => { cursor++; return fn }, useEffect() { cursor++ }, useMemo: fn => { cursor++; return fn() },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
  }
  return { hooks, run: fn => { cursor = 0; return fn() } }
}

test('an apply with an unknown outcome closes the confirmation, blocks 应用 and offers 「核对」', async () => {
  const rt = hookRuntime(), toasts = []
  const ui = { ConfirmDialog: 'confirm-dialog', Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description', Button: 'button' }
  const ddl = compile(ddlSource, { react: rt.hooks, '@zhin.js/console-ui': ui, 'lucide-react': new Proxy({}, { get: () => 'i' }) })
  const editor = compile(editorSource, {
    react: rt.hooks, '@zhin.js/console-ui': new Proxy(ui, { get: (target, name) => target[name] ?? String(name) }), 'lucide-react': new Proxy({}, { get: () => 'i' }),
    '../../components/StatusState': { StatusState: 'status-state' },
    '../../components/toast': { useToast: () => ({ success: message => toasts.push(message) }) },
    './ddl-outcome': ddl,
  })
  const plan = { change: { kind: 'drop-column', table: 'users', column: 'age' }, statements: ['ALTER TABLE users DROP COLUMN age'], destructive: true, confirm: 'age' }
  const applies = [], verified = []
  const admin = { preview: async () => plan, apply: async (change, confirm) => { applies.push([change, confirm]); throw unknown() } }
  const render = () => rt.run(() => editor.useSchemaApply(admin, () => {}, async held => { verified.push(held); return alterCheckResult() }))

  let apply = render()
  await apply.preview(plan.change); apply = render()
  apply.confirm(); apply = render()
  assert.equal(apply.dialog.props.open, true)
  await apply.dialog.props.onConfirm(); apply = render()
  assert.equal(applies.length, 1)
  assert.equal(apply.dialog.props.open, false, 'not left open with a live 「应用」')
  assert.equal(apply.held, true)
  assert.equal(apply.plan, null, 'the plan that may have run is not offered again')
  const notice = ddl.DdlCheckNotice(apply.notice.props)
  assert.ok('data-ddl-unknown' in notice.props)
  // Previewing again and confirming does nothing while held.
  await apply.preview(plan.change); apply = render()
  apply.confirm(); apply = render()
  assert.equal(apply.dialog.props.open, false)
  await apply.dialog.props.onConfirm()
  assert.equal(applies.length, 1, 'no second db:schema:apply')

  // 「核对」 re-reads; the hold is released and 应用 is available again.
  await apply.notice.props.controller.check(); apply = render()
  assert.deepEqual(verified, [plan])
  assert.equal(apply.held, false)
  assert.equal(ddl.DdlCheckNotice(apply.notice.props).props.role, 'status')
  assert.deepEqual(toasts, [])
})

test('a plain failure keeps the confirmation open with the reason, the Host text under 技术详情', async () => {
  const rt = hookRuntime()
  const ui = { ConfirmDialog: 'confirm-dialog', Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description', Button: 'button' }
  const ddl = compile(ddlSource, { react: rt.hooks, '@zhin.js/console-ui': ui, 'lucide-react': new Proxy({}, { get: () => 'i' }) })
  const editor = compile(editorSource, {
    react: rt.hooks, '@zhin.js/console-ui': new Proxy(ui, { get: (target, name) => target[name] ?? String(name) }), 'lucide-react': new Proxy({}, { get: () => 'i' }),
    '../../components/StatusState': { StatusState: 'status-state' }, '../../components/toast': { useToast: () => ({ success() {} }) }, './ddl-outcome': ddl,
  })
  const plan = { change: { kind: 'add-column', table: 'users' }, statements: [], destructive: false }
  const admin = { preview: async () => plan, apply: async () => { throw new Error('duplicate column name: age') } }
  const render = () => rt.run(() => editor.useSchemaApply(admin, () => {}, async () => alterCheckResult()))
  let apply = render()
  await apply.preview(plan.change); apply = render()
  apply.confirm(); apply = render()
  await assert.rejects(apply.dialog.props.onConfirm(), /结构没有修改/)
  apply = render()
  assert.equal(apply.held, false)
  const details = [apply.dialog.props.children].flat(Infinity).find(node => node?.props && 'details' in node.props)
  assert.equal(details.props.details, 'duplicate column name: age')
})
