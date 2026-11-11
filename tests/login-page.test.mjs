import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as loginModel from '../console-ui/src/pages/login-model.mjs'

const pageUrl = new URL('../console-ui/src/pages/login.tsx', import.meta.url)
const source = await readFile(pageUrl, 'utf8')
const requireFromPage = createRequire(pageUrl)

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
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function fixture({ verify = async () => ({ ok: true }), props: initialProps = {}, saved = [] } = {}) {
  const r = runtime(), calls = { verify: [], saved: [], success: 0, consumed: 0 }
  const auth = {
    getSavedLogin: () => null, getStoredApiBase: () => null, listSavedLogins: () => saved.map(apiBase => ({ apiBase, token: 'saved-secret', savedAt: 1, lastUsedAt: 1 })), normalizeApiBase: value => value.trim().replace(/\/$/, ''),
    removeSavedLogin() {}, touchSavedLogin() {}, upsertSavedLogin: (...args) => calls.saved.push(args),
    verifyAndStoreCredentials: (...args) => { calls.verify.push(args); return verify(...args) },
  }
  const mocks = {
    react: { ...r.hooks },
    '../components/LanguageSelect': { LanguageSelect: 'language-select' },
    '../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../components/ui/input': { Input: 'input' },
    '../components/ui/button': { Button: 'button' },
    '../components/ui/checkbox': { Checkbox: 'checkbox' },
    '../components/ui/select': { Select: 'select', SelectContent: 'select-content', SelectItem: 'option', SelectTrigger: 'select-trigger', SelectValue: 'select-value' },
    '../utils/auth': auth,
    './login-model.mjs': loginModel,
    './login.css': {},
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : requireFromPage(name), module.exports, module)
  const LoginPage = module.exports.default
  const props = { onSuccess: () => { calls.success++ }, onInitialTokenConsumed: () => { calls.consumed++ }, ...initialProps }
  const focused = []
  const all = () => elements(r.value)
  const byId = id => all().find(node => node.props?.id === id)
  const input = id => {
    const node = all().find(node => node.type === 'input' && node.props.id === id)
    // Stand in for the DOM node so the page can move focus.
    if (node?.props.ref && typeof node.props.ref === 'object') node.props.ref.current = { focus: () => focused.push(id) }
    return node
  }
  const f = {
    r, calls, focused, all, byId, input,
    mount() { r.mount(() => LoginPage(props)); input('console-login-address'); input('console-login-token'); const summary = byId('console-login-error'); return f },
    type(id, value) { input(id).props.onChange({ target: { value } }); r.render(); input('console-login-address'); input('console-login-token') },
    async submit() { all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); r.render(); input('console-login-address'); input('console-login-token'); await flush(); r.render() },
    describedText(id) { return String(input(id).props['aria-describedby'] ?? '').split(/\s+/).filter(Boolean).map(ref => text(byId(ref))).join(' ') },
    dialog() { return all().find(node => node.type === 'confirm-dialog') },
    labelFor(id) { return all().find(node => node.type === 'label' && node.props.htmlFor === id) },
  }
  return f
}

test('each input is named by its visible label and nothing else', () => {
  const f = fixture().mount()
  for (const [id, label] of [['console-login-address', 'Host 地址'], ['console-login-token', '访问令牌']]) {
    const field = f.input(id)
    assert.equal(field.props['aria-label'], undefined, `${id} must not override its visible label`)
    assert.equal(text(f.labelFor(id)).trim(), label)
  }
  // The hint is a description, not part of the name.
  assert.match(f.describedText('console-login-address'), /填写机器人启动日志中的地址/)
})

test('an empty token is reported on the token field, linked to it, and focused', async () => {
  const f = fixture().mount()
  await f.submit()
  assert.equal(f.calls.verify.length, 0)
  const token = f.input('console-login-token')
  assert.equal(token.props['aria-invalid'], true)
  assert.match(f.describedText('console-login-token'), /请输入访问令牌/)
  assert.deepEqual(f.focused, ['console-login-token'])
  assert.notEqual(f.input('console-login-address').props['aria-invalid'], true)
})

test('a Host address without a scheme is normalized before verification instead of failing', async () => {
  const f = fixture().mount()
  const address = f.input('console-login-address')
  assert.notEqual(address.props.type, 'url', 'native URL validation would reject 127.0.0.1:8086 before it can be normalized')
  f.type('console-login-address', '127.0.0.1:8086/')
  f.type('console-login-token', 'secret-1')
  await f.submit()
  assert.equal(f.calls.verify.length, 1)
  assert.equal(f.calls.verify[0][0], 'http://127.0.0.1:8086')
  assert.equal(f.calls.verify[0][1], 'secret-1')
  assert.equal(f.calls.success, 1)
})

test('an obviously invalid address is reported in place without contacting the Host', async () => {
  const f = fixture().mount()
  f.type('console-login-address', 'ftp://bot.example.com')
  f.input('console-login-address').props.onBlur?.({ target: { value: 'ftp://bot.example.com' } }); f.r.render()
  assert.equal(f.input('console-login-address').props['aria-invalid'], true)
  assert.match(f.describedText('console-login-address'), /http:\/\/ 或 https:\/\//)
  f.type('console-login-token', 'secret-1')
  await f.submit()
  assert.equal(f.calls.verify.length, 0)
  assert.deepEqual(f.focused, ['console-login-address'])
})

test('server failures land on the field that caused them, or on a focused summary', async () => {
  const rejected = fixture({ verify: async () => ({ ok: false, status: 401, message: 'Token 无效，请检查后重试' }) }).mount()
  rejected.type('console-login-token', 'wrong'); await rejected.submit()
  assert.equal(rejected.input('console-login-token').props['aria-invalid'], true)
  assert.match(rejected.describedText('console-login-token'), /Token 无效/)
  assert.deepEqual(rejected.focused, ['console-login-token'])

  const unreachable = fixture({ verify: async () => ({ ok: false, message: '无法连接 Host' }) }).mount()
  unreachable.type('console-login-token', 'secret'); await unreachable.submit()
  assert.equal(unreachable.input('console-login-address').props['aria-invalid'], true)
  assert.match(unreachable.describedText('console-login-address'), /无法连接 Host/)
  assert.deepEqual(unreachable.focused, ['console-login-address'])

  const failed = fixture({ verify: async () => ({ ok: false, status: 500, message: '验证失败 (HTTP 500)' }) }).mount()
  const focusedSummary = []
  failed.type('console-login-token', 'secret')
  failed.all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); failed.r.render(); await flush()
  failed.r.render()
  const summary = failed.byId('console-login-error')
  assert.equal(summary.props.role, 'alert')
  assert.equal(summary.props.tabIndex, -1)
  assert.match(text(summary), /HTTP 500/)
  summary.props.ref.current = { focus: () => focusedSummary.push('summary') }
  await failed.submit()
  assert.deepEqual(focusedSummary, ['summary'])
})

test('a #token= link to a saved Host signs in once, is consumed, and a failure keeps manual sign-in available', async () => {
  const logged = []
  const originals = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, console[name]]))
  for (const name of Object.keys(originals)) console[name] = (...args) => logged.push(args.join(' '))
  try {
    let answer = { ok: false, status: 401, message: 'Token 无效，请检查后重试' }
    const f = fixture({ verify: async () => answer, saved: ['http://127.0.0.1:8086'], props: { initialApiBase: '127.0.0.1:8086', initialToken: 'link-secret' } }).mount()
    await flush(); f.r.render(); f.r.render()
    assert.equal(f.calls.verify.length, 1, 'the link signs in exactly once')
    assert.deepEqual(f.calls.verify[0].slice(0, 2), ['http://127.0.0.1:8086', 'link-secret'])
    assert.equal(f.calls.consumed, 1)
    assert.equal(f.calls.success, 0)
    assert.equal(f.dialog().props.open, false, 'a saved Host needs no confirmation')
    assert.equal(f.input('console-login-token').props['aria-invalid'], true)
    assert.match(f.describedText('console-login-token'), /Token 无效/)
    assert.equal(f.input('console-login-token').props.disabled, false)
    assert.equal(f.calls.saved.length, 0, 'a link token is not saved unless the person chooses to remember it')

    answer = { ok: true }
    f.type('console-login-token', 'typed-secret')
    await f.submit()
    assert.deepEqual(f.calls.verify[1].slice(0, 2), ['http://127.0.0.1:8086', 'typed-secret'])
    assert.equal(f.calls.success, 1)
  } finally { Object.assign(console, originals) }
  assert.ok(!logged.some(line => line.includes('secret')), 'tokens are never logged')
})

test('a successful #token= link to a saved Host signs in without any input', async () => {
  const f = fixture({ saved: ['http://localhost:8086/'], props: { initialToken: 'link-secret' } }).mount()
  await flush(); f.r.render()
  assert.deepEqual(f.calls.verify[0].slice(0, 2), ['http://localhost:8086', 'link-secret'])
  assert.equal(f.calls.success, 1)
})

test('a link to a Host that is not saved asks first and shows the Host it will connect to', async () => {
  const f = fixture({ saved: ['http://127.0.0.1:8086'], props: { initialApiBase: 'https://unknown.example', initialToken: 'link-secret' } }).mount()
  await flush(); f.r.render()
  assert.equal(f.calls.verify.length, 0, 'nothing is sent before the person confirms')
  assert.equal(f.calls.consumed, 1)
  const dialog = f.dialog()
  assert.equal(dialog.props.open, true)
  assert.match(dialog.props.description, /https:\/\/unknown\.example/)
  assert.equal(f.input('console-login-token').props.value, '', 'the token is not filled in before confirmation')
  dialog.props.onConfirm(); dialog.props.onOpenChange(false); f.r.render(); await flush(); f.r.render()
  assert.deepEqual(f.calls.verify[0].slice(0, 2), ['https://unknown.example', 'link-secret'])
  assert.equal(f.calls.success, 1)
  assert.equal(f.dialog().props.open, false)
})

test('cancelling the confirmation only prefills the address and never signs in', async () => {
  const f = fixture({ props: { initialApiBase: 'http://192.168.1.9:8086', initialToken: 'link-secret' } }).mount()
  await flush(); f.r.render()
  assert.equal(f.dialog().props.open, true)
  f.dialog().props.onOpenChange(false); f.r.render(); await flush(); f.r.render()
  assert.equal(f.dialog().props.open, false)
  assert.equal(f.calls.verify.length, 0)
  assert.equal(f.input('console-login-address').props.value, 'http://192.168.1.9:8086')
  assert.equal(f.input('console-login-token').props.value, '', 'the link token is dropped')
  // The person can still sign in by hand, and the dropped link token is not reused.
  f.type('console-login-token', 'typed-secret'); await f.submit()
  assert.deepEqual(f.calls.verify.map(call => call[1]), ['typed-secret'])
})

test('a rejected ?token= is explained on the login page', () => {
  const f = fixture({ props: { queryTokenRejected: true } }).mount()
  const summary = f.byId('console-login-error')
  assert.equal(summary.props.role, 'alert')
  assert.match(text(summary), /token 不能放在 \? 参数里/)
  assert.equal(f.calls.verify.length, 0)
})
