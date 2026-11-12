import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createFileDraftSessions } from '../console-ui/src/pages/files/draft-session.mjs'
import * as fileTreeModel from '../console-ui/src/pages/files/file-tree-model.mjs'
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
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : value && typeof value === 'object' ? [value.props?.children].flat(Infinity).map(text).join('') : ''

function fixture(initialQuery = '', treeRead = { data: [], loaded: true, error: null }) {
  const r = runtime(), sessions = createFileDraftSessions(), updates = [], calls = []
  let manager = { name: 'host-A' }, scope = 'scope-A', active = true, params = new URLSearchParams(initialQuery), demo = false
  // A stable read object, like React state between renders; retry counts Host tree reads.
  const read = { loading: false, ...treeRead, refreshes: 0 }
  read.refresh = async () => { read.refreshes += 1 }
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  const setSearchParams = (next, options) => { params = typeof next === 'function' ? next(params) : next; updates.push({ query: params.toString(), options }); r.invalidate() }
  const mocks = {
    react: { ...r.hooks },
    'react-router-dom': { useSearchParams: () => [params, setSearchParams] },
    '../../utils/console-client': { getConsoleTransport: () => manager },
    './draft-session.mjs': { createFileDraftSessions: () => sessions },
    '../../utils/useInboxCacheScope': { useInboxCacheScope: () => scope },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: () => active },
    '../../utils/console-access.mjs': { hasConsolePermission: () => !demo },
    '../../hooks/use-console-read': { useConsoleRead: () => read },
    './file-tree-model.mjs': fileTreeModel,
    '../../components/ui/input': { Input: 'input' },
    '../../utils/read-error.mjs': { readErrorSummary: value => String(value) },
    './file-tree.css': {}, './file-icons': { getFileIcon: () => null }, './language': { getLanguage: () => 'text' },
    './file-editor': { FileEditor: 'file-editor' }, './tree-node': { TreeNode: 'tree-node' },
    './code-editor': { CodeEditor: 'code-editor' },
    '../../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../../components/PageHeader': { PageHeader: 'page-header' }, '../../components/empty-state': { EmptyState: 'empty' },
    '../../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/badge': { Badge: 'span' },
    '../../components/ui/alert': { Alert: 'aside', AlertDescription: 'p' }, '../../components/error-alert': { ErrorAlert: 'aside' }, '../ops/load-state': { OpsLoadState: 'aside' },
    '../../components/ui/scroll-area': { ScrollArea: 'div' },
    '../../components/connection-required': { ConnectionRequiredState: 'connection-required' },
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
    r, page, editor, sessions, calls, updates, read,
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
  // An inactive authority never renders the old session; it shows the shared re-login state instead of a blank page.
  assert.equal(f.page.default().type, 'connection-required')
})

const nestedTree = [
  { type: 'directory', name: 'src', path: 'src', children: [
    { type: 'directory', name: 'a', path: 'src/a', children: [
      { type: 'directory', name: 'b', path: 'src/a/b', children: [
        { type: 'file', name: 'target.ts', path: 'src/a/b/target.ts' },
        { type: 'directory', name: 'deep', path: 'src/a/b/deep', children: [] },
      ] },
    ] },
    { type: 'file', name: 'index.ts', path: 'src/index.ts' },
  ] },
  { type: 'file', name: 'package.json', path: 'package.json' },
]

test('a deep link expands every ancestor directory of the linked file in the tree', () => {
  const f = fixture('path=src%2Fa%2Fb%2Ftarget.ts', { data: nestedTree, loaded: true, error: null })
  f.mount()
  const root = elements(f.r.value).find(item => item.type === 'tree-node' && item.props.node.path === 'src')
  assert.equal(root.props.selectedPath, 'src/a/b/target.ts')
  assert.ok(root.props.expansion, 'the page owns expansion so it can reveal nested files')
  for (const ancestor of ['src', 'src/a', 'src/a/b']) assert.equal(root.props.expansion.get(ancestor), true, ancestor)
  assert.equal(root.props.expansion.has('src/a/b/deep'), false)
  // A manual collapse is kept until the selection changes.
  root.props.onToggle('src/a', false); f.r.render()
  assert.equal(elements(f.r.value).find(item => item.type === 'tree-node').props.expansion.get('src/a'), false)
  assert.doesNotMatch(text(f.r.value), /文件树中没有/)
})

test('a deep link to a path the loaded tree does not contain explains it instead of silently showing nothing', () => {
  const missing = fixture('path=src%2Fa%2Fgone.ts', { data: nestedTree, loaded: true, error: null })
  missing.mount()
  assert.match(text(missing.r.value), /文件树中没有 src\/a\/gone\.ts/)
  assert.equal(find(missing.r, 'file-editor').props.filePath, 'src/a/gone.ts', 'the Host read still decides and reports the final error')
  const deep = fixture('path=src%2Fa%2Fb%2Fdeep%2Fx.ts', { data: nestedTree, loaded: true, error: null })
  deep.mount()
  assert.match(text(deep.r.value), /超出 Host 文件树返回的目录深度/)
  for (const ancestor of ['src', 'src/a', 'src/a/b', 'src/a/b/deep']) assert.equal(find(deep.r, 'tree-node').props.expansion.get(ancestor), true)
})

test('file-name search filters only the loaded tree, says so, and selecting a result reveals it', () => {
  const f = fixture('', { data: nestedTree, loaded: true, error: null })
  f.mount()
  const input = find(f.r, 'input')
  assert.ok(input, 'a search field is rendered once the tree has entries')
  assert.equal(input.props['aria-label'], '搜索文件名')
  input.props.onChange({ target: { value: 'TARGET' } }); f.r.render()
  assert.equal(find(f.r, 'tree-node'), undefined)
  assert.match(text(f.r.value), /仅搜索已加载的目录/)
  const results = elements(f.r.value).filter(item => item.type === 'button' && item.props['data-search-result'])
  assert.deepEqual(results.map(item => item.props.title), ['src/a/b/target.ts'])
  results[0].props.onClick(); f.r.render()
  assert.equal(find(f.r, 'file-editor').props.filePath, 'src/a/b/target.ts')
  assert.equal(f.query.get('path'), 'src/a/b/target.ts')
  assert.equal(find(f.r, 'input').props.value, '')
  assert.equal(find(f.r, 'tree-node').props.expansion.get('src/a/b'), true)
  find(f.r, 'input').props.onChange({ target: { value: 'nothing-here' } }); f.r.render()
  assert.match(text(f.r.value), /已加载的目录中没有名称包含「nothing-here」的文件/)
})

test('a failed tree read shows the error with retry and no empty state', async () => {
  const f = fixture('', { data: [], loaded: false, error: 'tree denied' })
  f.mount()
  assert.equal(find(f.r, 'empty'), undefined, 'an error is not an empty directory')
  const alerts = elements(f.r.value).filter(item => item.type === 'aside' && item.props.onRetry)
  assert.equal(alerts.length, 1, 'exactly one retry entry point')
  await alerts[0].props.onRetry()
  assert.equal(f.read.refreshes, 1)
  // A refresh failure with a cached tree keeps the tree and still offers retry.
  const stale = fixture('', { data: nestedTree, loaded: true, error: 'refresh failed' })
  stale.mount()
  assert.ok(find(stale.r, 'tree-node'))
  assert.equal(elements(stale.r.value).filter(item => item.type === 'aside' && item.props.onRetry).length, 1)
})

test('a failed file read shows the error with retry instead of an empty editor, and retry reloads it', async () => {
  const f = fixture()
  let attempts = 0
  const props = { filePath: 'src/a.ts', readOnly: false, onClose() {}, onDraftChange() {}, saveFile: async () => {},
    readFile: async () => { attempts += 1; if (attempts === 1) throw new Error('read denied'); return 'loaded text' } }
  f.r.mount(() => f.editor.FileEditor(props)); await f.r.settle()
  assert.equal(find(f.r, 'code-editor'), undefined, 'no blank editable buffer after a failed read')
  assert.match(text(f.r.value), /read denied/)
  const retry = elements(f.r.value).find(item => item.type === 'button' && text(item).includes('重试'))
  assert.ok(retry)
  await retry.props.onClick(); await f.r.settle()
  assert.equal(attempts, 2)
  assert.equal(find(f.r, 'code-editor').props.value, 'loaded text')
})
