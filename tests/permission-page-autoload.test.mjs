import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { permissionRequest, readPermissionCatalog, readPermissionExplanation, permissionHttpError } from '../console-ui/src/pages/permission-explanation-model.mjs'
import * as linkModel from '../console-ui/src/pages/permission-link-model.mjs'

const { readPermissionLink, permissionLinkSearch, permissionLinkFor, matchPermissionLink, permissionCatalogState, permissionCommandName } = linkModel

const status = { id: 'root/demo\0zhin.command\0status', owner: 'root/demo', name: 'status', description: '状态', permits: [] }
const other = { id: 'root/other\0zhin.command\0status', owner: 'root/other', name: 'status', description: '另一个', permits: [] }
const help = { id: 'root\0zhin.command\0help', owner: 'root', name: 'help', description: '帮助', permits: [] }

test('reads deep links by exact id, normalized command name and optional owner', () => {
  assert.equal(readPermissionLink(new URLSearchParams()), null)
  assert.equal(readPermissionLink(null), null)
  assert.deepEqual(readPermissionLink(new URLSearchParams('command=%20echo%20%3Ctext%3E%20&owner=root')), { id: '', name: 'echo', owner: 'root' })
  assert.deepEqual(readPermissionLink(new URLSearchParams({ id: status.id })), { id: status.id, name: '', owner: '' })
  assert.equal(permissionCommandName('config   get [key]'), 'config get')
  assert.equal(permissionCommandName('<only>'), '<only>')
})

test('writes the selected command back as a reloadable link', () => {
  const params = permissionLinkSearch(status)
  assert.deepEqual(readPermissionLink(params), { id: status.id, name: 'status', owner: 'root/demo' })
  assert.equal(permissionLinkFor('echo <text>', 'demo'), '/permissions?command=echo&owner=demo')
  assert.equal(permissionLinkFor(''), '/permissions')
})

test('selects only an unambiguous command and never guesses between plugin instances', () => {
  const commands = [status, other, help]
  assert.deepEqual(matchPermissionLink(commands, null), { status: 'none' })
  assert.equal(matchPermissionLink(commands, { id: other.id, name: 'status', owner: '' }).command, other)
  assert.equal(matchPermissionLink(commands, { id: '', name: 'help', owner: '' }).command, help)
  assert.equal(matchPermissionLink(commands, { id: '', name: 'status', owner: 'root/demo' }).command, status)
  assert.equal(matchPermissionLink(commands, { id: '', name: 'status', owner: '' }).status, 'ambiguous')
  assert.equal(matchPermissionLink(commands, { id: '', name: 'status', owner: 'nope' }).status, 'ambiguous')
  assert.equal(matchPermissionLink([help], { id: '', name: 'help', owner: 'plugin-alias' }).command, help)
  assert.equal(matchPermissionLink(commands, { id: 'gone', name: '', owner: '' }).status, 'missing')
  assert.equal(matchPermissionLink(commands, { id: '', name: 'missing', owner: '' }).status, 'missing')
})

test('catalog state distinguishes unavailable, loading, failure, unread and empty', () => {
  const base = { denied: false, active: true, loading: false, error: null, catalog: null }
  assert.equal(permissionCatalogState({ ...base, denied: true }), 'unavailable')
  assert.equal(permissionCatalogState({ ...base, active: false }), 'unavailable')
  assert.equal(permissionCatalogState({ ...base, loading: true }), 'loading')
  assert.equal(permissionCatalogState({ ...base, error: 'boom' }), 'error')
  assert.equal(permissionCatalogState(base), 'idle')
  assert.equal(permissionCatalogState({ ...base, catalog: { commands: [] } }), 'empty')
  assert.equal(permissionCatalogState({ ...base, catalog: { commands: [help] } }), 'ready')
})

// Minimal hook runtime: runs the production state/effect lifecycle of the page up to its JSX.
function hooks() {
  const slots = []; let cursor = 0, pending = [], dirty = false, render, value
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const api = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true } }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  return { api, mount(fn) { render = fn; return this.render() }, render() { let n = 0; do { assert.ok(++n < 50); dirty = false; cursor = 0; value = render(); const effects = pending; pending = []; effects.forEach(fn => fn()) } while (dirty); return value }, async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty || pending.length) this.render() } return value }, get value() { return value } }
}
async function page(bindings) {
  const file = 'pages/command-permissions.tsx', name = 'CommandPermissionsPage', stop = '  return <PageShell'
  const source = await readFile(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration; const find = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) declaration = n; ts.forEachChild(n, find) }; find(ast); assert.ok(declaration)
  let code = declaration.getText(ast).replace(/^export (default )?/, ''); assert.ok(code.indexOf(stop) > 0)
  code = code.slice(0, code.indexOf(stop)) + "return { current, selected, query, loading, catalogError: typeof catalogError === 'undefined' ? error : catalogError, loadCatalog };}"
  code = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  return Function(...Object.keys(bindings), `${code};return ${name}`)(...Object.values(bindings))
}
function harness({ search = '', active = true, fail = 0 } = {}) {
  const runtime = hooks(), requests = [], writes = [], scope = 'permission-fixture'
  let params = new URLSearchParams(search), failures = fail
  const bindings = {
    ...runtime.api, ...linkModel, useI18n: () => ({ locale: 'zh-CN', t: (message, values) => translate('zh-CN', message, values) }),
    useInboxCacheScope: () => scope, getInboxCacheScope: () => scope, isInboxCacheScopeActive: value => active && value === scope, hasConsolePermission: () => true,
    useSearchParams: () => [params, (next, options) => { params = new URLSearchParams(next); writes.push({ search: params.toString(), options }) }],
    createDiagnosticRequestGate, permissionRequest, readPermissionCatalog, readPermissionExplanation, permissionHttpError,
    CONSOLE_REST: { COMMAND_PERMISSIONS: '/catalog', COMMAND_PERMISSION_EXPLAIN: '/explain' },
    apiFetch: async (url, options = {}) => {
      requests.push({ url, options })
      if (options.method === 'POST') {
        const body = JSON.parse(options.body), command = [status, other, help].find(item => item.id === body.commandId)
        return { ok: true, json: async () => ({ success: true, data: { generation: 3, simulation: true, command, permissionHost: 'present', adapter: { outcome: 'not_evaluated', reason: 'fixture' },
          rules: [], summary: { outcome: 'match', reason: 'fixture' }, unconstrained: [], assumptions: [] } }) }
      }
      if (failures > 0) { failures--; return { ok: false, status: 500, json: async () => ({}) } }
      const q = new URL(url, 'https://example.test').searchParams.get('q') ?? ''
      const commands = [status, other, help].filter(item => !q || item.name.includes(q))
      return { ok: true, json: async () => ({ success: true, data: { generation: 3, page: 1, pageSize: 50, total: commands.length, commands } }) }
    },
  }
  return { runtime, requests, writes, bindings, catalogReads: () => requests.filter(item => item.options.method !== 'POST').map(item => new URL(item.url, 'https://example.test').searchParams) }
}

test('entering the page reads the current command catalog without a manual click', async () => {
  const h = harness(), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.catalogReads().length, 1, 'catalog is requested on entry')
  assert.equal(h.catalogReads()[0].get('page'), '1')
  assert.deepEqual(h.runtime.value.current.commands.map(item => item.id), [status.id, other.id, help.id])
  assert.equal(h.runtime.value.selected, null)
  assert.deepEqual(h.writes, [], 'no URL rewrite without a selection')
})

test('a link from the command directory searches for and selects that command, then keeps it in the URL', async () => {
  const h = harness({ search: 'command=status&owner=root/demo' }), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.catalogReads()[0].get('q'), 'status', 'linked command is used as the catalog search')
  assert.equal(h.runtime.value.query, 'status')
  assert.equal(h.runtime.value.selected?.id, status.id)
  const explain = h.requests.find(item => item.options.method === 'POST')
  assert.ok(explain, 'selected command rules are read automatically')
  assert.equal(JSON.parse(explain.options.body).commandId, status.id)
  assert.equal(h.writes.at(-1).options.replace, true)
  assert.equal(new URLSearchParams(h.writes.at(-1).search).get('id'), status.id)
})

test('a reloaded URL with the exact id selects the same instance even when names collide', async () => {
  const h = harness({ search: permissionLinkSearch(other).toString() }), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.runtime.value.selected?.id, other.id)
})

test('an ambiguous link does not guess a command', async () => {
  const h = harness({ search: 'command=status' }), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.runtime.value.current.commands.length, 2)
  assert.equal(h.runtime.value.selected, null)
  assert.equal(h.requests.filter(item => item.options.method === 'POST').length, 0)
})

test('a failed catalog read is an error state that can be retried, not an empty catalog', async () => {
  const h = harness({ search: 'command=help', fail: 1 }), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.runtime.value.current, null)
  assert.equal(h.runtime.value.loading, false)
  assert.match(h.runtime.value.catalogError, /权限说明读取失败/)
  await h.runtime.value.loadCatalog(); await h.runtime.settle()
  assert.equal(h.runtime.value.catalogError, null)
  assert.equal(h.runtime.value.selected?.id, help.id, 'retry still honours the linked command')
})

test('without a connected Host nothing is requested', async () => {
  const h = harness({ active: false, search: 'command=help' }), component = await page(h.bindings)
  h.runtime.mount(() => component()); await h.runtime.settle()
  assert.equal(h.requests.length, 0)
  assert.equal(h.runtime.value.loading, false)
})
