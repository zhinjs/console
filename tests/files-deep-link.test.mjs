import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createFileDraftSessions } from '../console-ui/src/pages/files/draft-session.mjs'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

const require = createRequire(import.meta.url)
const pageSource = await readFile(new URL('../console-ui/src/pages/files/files-page.tsx', import.meta.url), 'utf8')
const editorSource = await readFile(new URL('../console-ui/src/pages/files/file-editor.tsx', import.meta.url), 'utf8')

// Execute production component handlers with the same effect/cleanup ordering as React.
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
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
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
    invalidate() { dirty = true },
    render() {
      let count = 0
      do { assert.ok(++count < 30, 'query navigation must settle'); dirty = false; cursor = 0; value = render(); const pending = effects; effects = []; pending.forEach(fn => fn()) } while (dirty)
      return value
    },
    async settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); this.render() }; return value },
    unmount() { for (const slot of slots) slot?.cleanup?.(); slots.length = 0; effects = [] },
    get value() { return value },
  }
}
const elements = value => value && typeof value === 'object' ? [value, ...[value.props?.children, value.props?.actions].flat(Infinity).flatMap(elements)] : []
const find = (r, type) => elements(r.value).find(item => item.type === type)

function fixture(initialQuery = '') {
  const r = runtime(), sessions = createFileDraftSessions(), updates = [], calls = []
  let manager = { name: 'host-A' }, scope = 'scope-A', active = true, params = new URLSearchParams(initialQuery), demo = false
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  const setSearchParams = (next, options) => { params = typeof next === 'function' ? next(params) : next; updates.push({ query: params.toString(), options }); r.invalidate() }
  const mocks = {
    react: { ...r.hooks },
    'react-router-dom': { useSearchParams: () => [params, setSearchParams] },
    '@zhin.js/client': { getWebSocketManager: () => manager },
    './draft-session.mjs': { createFileDraftSessions: () => sessions },
    '../../utils/useInboxCacheScope': { useInboxCacheScope: () => scope },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: () => active },
    '../../utils/demo-mode': { isDemoMode: () => demo },
    '../../hooks/use-console-read': { useConsoleRead: () => ({ data: [], loaded: true, loading: false, error: null, refresh: async () => {} }) },
    '../../utils/read-error.mjs': { readErrorSummary: value => String(value) },
    './file-tree.css': {}, './file-icons': { getFileIcon: () => null }, './language': { getLanguage: () => 'text' },
    './file-editor': { FileEditor: 'file-editor' }, './tree-node': { TreeNode: 'tree-node' },
    './code-editor': { CodeEditor: 'code-editor' },
    '../../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../../components/PageHeader': { PageHeader: 'page-header' }, '../../components/empty-state': { EmptyState: 'empty' },
    '../../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/badge': { Badge: 'span' },
    '../../components/ui/alert': { Alert: 'aside', AlertDescription: 'p' },
    '../../components/ui/scroll-area': { ScrollArea: 'div' },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
  }
  function compile(source) {
    const module = { exports: {} }
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
    return module.exports
  }
  const page = compile(pageSource), editor = compile(editorSource)
  const installManager = current => {
    current.readFile = async path => { calls.push({ host: current.name, type: 'read', path }); return { content: `${current.name}:${path}` } }
    current.saveFile = async (path, content) => { calls.push({ host: current.name, type: 'save', path, content }); throw new Error('save denied') }
  }
  installManager(manager)
  return {
    r, page, editor, sessions, calls, updates,
    get manager() { return manager }, get query() { return params },
    mount() {
      // Render the keyed production session just as React does under the scope boundary.
      const outer = page.default()
      return r.mount(() => typeof outer.type === 'function' ? outer.type(outer.props) : page.default())
    },
    navigate(path) { params = new URLSearchParams({ path }); r.render() },
    setQuery(path) { params = new URLSearchParams({ path }) },
    switchHost() { manager = { name: 'host-B' }; installManager(manager); scope = 'scope-B' },
    setActive(value) { active = value }, setDemo(value) { demo = value },
  }
}

test('deep links decode once and select files beyond the shallow tree through existing readFile', async () => {
  const path = 'src/nested/deeper/中文 + %.ts', f = fixture(new URLSearchParams({ path }).toString())
  f.mount()
  const editor = find(f.r, 'file-editor')
  assert.equal(editor?.props.filePath, path)
  assert.equal(await editor.props.readFile(path), `host-A:${path}`)
  assert.deepEqual(f.calls, [{ host: 'host-A', type: 'read', path }])
})

test('returning through a deep link asks before discarding the original Host draft; cancel consumes the request', () => {
  const f = fixture(); f.sessions.get(f.manager).selected = 'src/before.ts'; f.mount()
  find(f.r, 'file-editor').props.onDraftChange({ content: 'draft A', originalContent: 'original A' })
  f.r.unmount()
  f.setQuery('src/after.ts'); f.mount()
  assert.equal(find(f.r, 'file-editor').props.filePath, 'src/before.ts')
  assert.equal(find(f.r, 'file-editor').props.draft.content, 'draft A')
  assert.equal(find(f.r, 'confirm-dialog').props.open, true)
  find(f.r, 'confirm-dialog').props.onOpenChange(false); f.r.render()
  assert.equal(find(f.r, 'confirm-dialog').props.open, false)
  assert.equal(f.query.get('path'), 'src/before.ts')
  f.r.render()
  assert.equal(find(f.r, 'confirm-dialog').props.open, false)
  assert.equal(f.sessions.get(f.manager).drafts.get('src/before.ts').content, 'draft A')
  assert.equal(f.calls.length, 0)
})

test('confirming a requested file discards only the prior draft and the dialog close cannot restore the old URL', () => {
  const f = fixture(); f.sessions.get(f.manager).selected = 'src/before.ts'; f.mount()
  find(f.r, 'file-editor').props.onDraftChange({ content: 'draft A', originalContent: 'original A' })
  f.sessions.get(f.manager).drafts.set('src/other.ts', { content: 'untouched', originalContent: '' })
  f.navigate('src/after.ts')
  const dialog = find(f.r, 'confirm-dialog')
  dialog.props.onConfirm(); dialog.props.onOpenChange(false); f.r.render()
  assert.equal(find(f.r, 'file-editor').props.filePath, 'src/after.ts')
  assert.equal(f.query.get('path'), 'src/after.ts')
  assert.equal(f.sessions.get(f.manager).drafts.has('src/before.ts'), false)
  assert.equal(f.sessions.get(f.manager).drafts.get('src/other.ts').content, 'untouched')
  find(f.r, 'file-editor').props.onClose(); f.r.render()
  assert.equal(find(f.r, 'file-editor'), undefined)
  assert.equal(f.query.has('path'), false)
})

test('existing editor save failure preserves linked-file content and dirty draft without automatic retry', async () => {
  const f = fixture('path=src%2Fa.ts'); f.sessions.get(f.manager).selected = 'src/a.ts'; f.mount()
  const props = find(f.r, 'file-editor').props
  f.r.unmount(); f.r.mount(() => f.editor.FileEditor(props)); await f.r.settle()
  find(f.r, 'code-editor').props.onChange('modified'); f.r.render()
  const save = elements(f.r.value).find(item => item.type === 'button' && item.props.onClick && !item.props.variant)
  assert.ok(save)
  await save.props.onClick(); await f.r.settle()
  assert.equal(find(f.r, 'code-editor').props.value, 'modified')
  assert.equal(f.sessions.get(f.manager).drafts.get('src/a.ts').content, 'modified')
  assert.equal(f.calls.filter(call => call.type === 'save').length, 1)
})

test('Host authority retires the previous session and new reads use only the new manager', async () => {
  const f = fixture('path=src%2Fa.ts'); f.sessions.get(f.manager).selected = 'src/a.ts'; f.mount()
  const oldManager = f.manager
  find(f.r, 'file-editor').props.onDraftChange({ content: 'private A draft', originalContent: 'original' })
  const before = f.page.default()
  f.switchHost()
  const after = f.page.default()
  assert.notEqual(before.key, after.key)
  f.r.unmount(); f.mount()
  const editor = find(f.r, 'file-editor')
  assert.equal(editor.props.draft, undefined)
  await editor.props.readFile(editor.props.filePath)
  assert.equal(f.calls.at(-1).host, 'host-B')
  assert.equal(f.sessions.get(oldManager).drafts.get('src/a.ts').content, 'private A draft')
  f.setActive(false)
  assert.equal(f.page.default(), null)
})
