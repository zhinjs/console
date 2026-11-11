import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

const componentUrl = new URL('../console-ui/src/components/confirm-dialog.tsx', import.meta.url)
const source = await readFile(componentUrl, 'utf8')
const requireFromComponent = createRequire(componentUrl)

// Minimal hook runtime: re-renders until state settles, runs effects after each pass.
function runtime() {
  const slots = []; let cursor = 0, dirty = false, effects = [], render, value
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const result = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(result, slots[i])) { slots[i] = result; dirty = true } }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn) { cursor++; return fn },
    useMemo(fn) { cursor++; return fn() },
    useId() { cursor++; return 'confirm-input' },
    useEffect(fn, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) {
        const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
      }
    },
  }
  return {
    hooks,
    mount(fn) { render = fn; return this.render() },
    render() {
      let count = 0
      do { assert.ok(++count < 30, 'render must settle'); dirty = false; cursor = 0; value = render(); const pending = effects; effects = []; pending.forEach(fn => fn()) } while (dirty)
      return value
    },
    get value() { return value },
  }
}

const elements = value => value && typeof value === 'object'
  ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)]
  : []
const text = value => value == null || typeof value === 'boolean' ? ''
  : typeof value !== 'object' ? String(value)
  : Array.isArray(value) ? value.map(text).join('')
  : text(value.props?.children)

function compile(r) {
  const mocks = {
    react: { ...r.hooks },
    '@zhin.js/client': { cn: (...names) => names.filter(Boolean).join(' ') },
    './ui/dialog': { Dialog: 'dialog', DialogContent: 'dialog-content', DialogHeader: 'header', DialogFooter: 'footer', DialogTitle: 'h2', DialogDescription: 'p', DialogClose: 'dialog-close' },
    './ui/button': { Button: 'button' },
    './ui/input': { Input: 'input' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromComponent(name), module.exports, module)
  return module.exports
}

function fixture(initialProps) {
  const r = runtime(), { ConfirmDialog } = compile(r), openChanges = []
  let props = { open: true, title: '删除表', variant: 'destructive', confirmLabel: '删除', onOpenChange: open => { openChanges.push(open) }, ...initialProps }
  r.mount(() => ConfirmDialog(props))
  return {
    r, openChanges,
    setProps(next) { props = { ...props, ...next }; r.render() },
    confirmButton: () => elements(r.value).find(node => node.type === 'button' && typeof node.props.onClick === 'function'),
    alert: () => elements(r.value).find(node => node.props?.role === 'alert'),
    input: () => elements(r.value).find(node => node.type === 'input'),
  }
}

test('a rejected confirmation keeps the dialog open and shows the error with role="alert"', async () => {
  let attempts = 0
  const f = fixture({ onConfirm: async () => { attempts += 1; if (attempts === 1) throw new Error('磁盘已满') } })
  assert.equal(f.alert(), undefined)

  await f.confirmButton().props.onClick()
  f.r.render()
  assert.deepEqual(f.openChanges, [], 'a failed confirmation must not close the dialog')
  assert.match(text(f.alert()), /磁盘已满/)
  assert.equal(f.confirmButton().props.disabled, false, 'the user can retry after a failure')

  await f.confirmButton().props.onClick()
  f.r.render()
  assert.deepEqual(f.openChanges, [false], 'a successful retry closes the dialog')
  assert.equal(f.alert(), undefined, 'retrying clears the previous error')
})

test('non-Error rejections still surface a readable message', async () => {
  const f = fixture({ onConfirm: () => Promise.reject('权限不足') })
  await f.confirmButton().props.onClick()
  f.r.render()
  assert.match(text(f.alert()), /权限不足/)

  const g = fixture({ onConfirm: () => Promise.reject(undefined) })
  await g.confirmButton().props.onClick()
  g.r.render()
  assert.match(text(g.alert()), /操作失败/)
})

test('synchronous throws are caught the same way', async () => {
  const f = fixture({ onConfirm: () => { throw new Error('同步失败') } })
  await f.confirmButton().props.onClick()
  f.r.render()
  assert.match(text(f.alert()), /同步失败/)
  assert.deepEqual(f.openChanges, [])
})

test('closing the dialog clears a stale error before it reopens', async () => {
  const f = fixture({ onConfirm: async () => { throw new Error('网络中断') } })
  await f.confirmButton().props.onClick()
  f.r.render()
  assert.ok(f.alert())
  f.setProps({ open: false })
  f.setProps({ open: true })
  assert.equal(f.alert(), undefined)
})

test('typed confirmation keeps the confirm button disabled until the exact name is entered', async () => {
  let confirmed = 0
  const f = fixture({ confirmText: 'users', onConfirm: () => { confirmed += 1 } })
  assert.ok(f.input(), 'an input is rendered when confirmText is set')
  assert.equal(f.confirmButton().props.disabled, true)
  f.input().props.onChange({ target: { value: 'user' } }); f.r.render()
  assert.equal(f.confirmButton().props.disabled, true)
  f.input().props.onChange({ target: { value: 'Users' } }); f.r.render()
  assert.equal(f.confirmButton().props.disabled, true, 'matching is case-sensitive')
  await f.confirmButton().props.onClick()
  assert.equal(confirmed, 0, 'the handler is guarded, not only the disabled attribute')
  f.input().props.onChange({ target: { value: 'users' } }); f.r.render()
  assert.equal(f.confirmButton().props.disabled, false)
  await f.confirmButton().props.onClick()
  assert.equal(confirmed, 1)

  f.setProps({ open: false }); f.setProps({ open: true })
  assert.equal(f.input().props.value, '', 'the typed name is reset when the dialog closes')
})

test('dialogs without confirmText render no input and stay enabled', () => {
  const f = fixture({ onConfirm: () => {} })
  assert.equal(f.input(), undefined)
  assert.equal(f.confirmButton().props.disabled, false)
})
