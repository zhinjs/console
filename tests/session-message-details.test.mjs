import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/SessionMessageDetails.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
function fixture() {
  const slots = [], calls = []; let scope = 'scope-a'; let cursor = 0, pending, cleanup, deps
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useEffect(effect, next) { if (!same(deps, next)) { cleanup?.(); deps = next; pending = effect } },
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => {
    if (name === 'react') return hooks
    if (isLocaleImport(name)) return localeModule
    if (name === '../utils/inbox-cache') return { isInboxCacheScopeActive: expected => expected === scope }
    if (name === '../utils/auth') return { apiFetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })) }
    if (name === '../contracts/zhin-console') return { CONSOLE_REST: { AGENT_SESSIONS: '/api/agent/sessions' } }
    if (name === '../components/error-alert') return { ErrorAlert: 'error-alert' }
    return require(name)
  }, module.exports, module)
  const props = { sessionKey: 'icqq:bot:group:room', sessionId: 'sid-1', messageId: 42, connectionScope: 'scope-a' }
  return { calls, props, setScope(value) { scope = value }, render() { cursor = 0; const tree = module.exports.SessionMessageDetails(props); if (pending) { const run = pending; pending = null; cleanup = run() } return tree }, close() { cleanup?.() } }
}
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const settle = () => new Promise(resolve => setImmediate(resolve))
const toggle = (tree, open) => tree.props.onToggle({ currentTarget: { open } })

test('full message loads only on expansion, in the exact session, with no branch mutation', async () => {
  const f = fixture(); let tree = f.render(); assert.equal(f.calls.length, 0)
  toggle(tree, true); f.render()
  assert.equal(f.calls.length, 1)
  const url = new URL(f.calls[0].url, 'http://fixture')
  assert.equal(decodeURIComponent(url.pathname), '/api/agent/sessions/icqq:bot:group:room/message')
  assert.equal(url.searchParams.get('sessionId'), 'sid-1'); assert.equal(url.searchParams.get('messageId'), '42')
  assert.equal(f.calls[0].options.method, undefined)
  assert.equal(f.calls[0].options.cache, 'no-store')
  const body = 'line one\n' + 'long original message '.repeat(100) + 'END'
  f.calls[0].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: body } }) })
  await settle(); tree = f.render(); assert.ok(text(tree).includes(body)); assert.equal(f.calls.length, 1); f.close()
})

test('collapsed or unmounted reads abort and late responses cannot replace newer results', async () => {
  const f = fixture(); let tree = f.render(); toggle(tree, true); tree = f.render(); toggle(tree, false); tree = f.render()
  assert.equal(f.calls[0].options.signal.aborted, true)
  toggle(tree, true); f.render()
  f.calls[1].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: 'current body' } }) })
  await settle()
  f.calls[0].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: 'stale body' } }) })
  await settle(); assert.ok(text(f.render()).includes('current body')); assert.ok(!text(f.render()).includes('stale body')); f.close()
})

test('old Hosts, missing messages and malformed responses show errors with an explicit retry', async () => {
  for (const status of [404, 501, 409, 500, 200]) {
    const f = fixture(); toggle(f.render(), true); f.render()
    f.calls[0].resolve({ status, ok: status === 200, json: async () => ({ success: status === 200, data: { messageId: 999, text: 'wrong message' }, error: 'fixture error' }) })
    await settle(); const tree = f.render(), error = elements(tree).find(e => e.type === 'error-alert')
    assert.ok(error?.props.error); assert.ok(!text(tree).includes('wrong message'))
    error.props.onRetry(); f.render(); assert.equal(f.calls.length, 2); f.close()
  }
})

test('changing session while a read is pending cancels the old scope', async () => {
  const f = fixture(); toggle(f.render(), true); f.render()
  f.props.sessionKey = 'icqq:bot:group:another-room'; f.props.sessionId = 'sid-2'; f.render()
  assert.equal(f.calls[0].options.signal.aborted, true)
  const url = new URL(f.calls[1].url, 'http://fixture')
  assert.equal(url.searchParams.get('sessionId'), 'sid-2')
  assert.ok(decodeURIComponent(url.pathname).includes('another-room'))
  f.calls[0].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: 'other room content' } }) })
  await settle(); assert.ok(!text(f.render()).includes('other room content')); f.close()
})

test('Host or credential changes invalidate late responses and already loaded text', async () => {
  for (const loaded of [false, true]) {
    const f = fixture(); toggle(f.render(), true); f.render()
    if (loaded) {
      f.calls[0].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: 'private A content' } }) })
      await settle(); assert.ok(text(f.render()).includes('private A content'))
    }
    f.setScope('scope-b')
    if (!loaded) {
      f.calls[0].resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { messageId: 42, text: 'private A content' } }) })
      await settle()
    }
    assert.equal(f.render(), null)
    f.props.connectionScope = 'scope-b'; f.render()
    assert.equal(f.calls[0].options.signal.aborted, true)
    assert.equal(f.calls.length, 2)
    assert.ok(!text(f.render()).includes('private A content'))
    f.close()
  }
})
