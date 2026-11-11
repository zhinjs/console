import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import ts from 'typescript'
import * as locale from '../console-ui/src/i18n/locale.mjs'
import * as masonry from '../console-ui/src/pages/introspection/masonry-layout.mjs'
import * as permissionLink from '../console-ui/src/pages/permission-link-model.mjs'
import * as emptyState from '../console-ui/src/pages/introspection/empty-state.mjs'
import * as targetPreview from '../console-ui/src/pages/introspection/target-preview.mjs'
import * as layoutModel from '../console-ui/src/pages/introspection/capability-layout-model.mjs'

const require = createRequire(import.meta.url)
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const { CAPABILITY_DETAIL_SHEET_QUERY, capabilityCountSummary } = layoutModel

test('the detail sheet query is the breakpoint where the workspace collapses and the inspector falls under the list', async () => {
  const css = await read('design-system.css')
  let collapsed
  postcss.parse(css).walkRules(rule => {
    if (!rule.selectors.includes('.console-capability-workspace')) return
    if (rule.parent?.type !== 'atrule' || rule.parent.name !== 'media') return
    rule.walkDecls('grid-template-columns', decl => { if (decl.value === '1fr') collapsed = rule.parent.params })
  })
  assert.equal(collapsed, '(max-width: 880px)', 'the single-column workspace starts at 880px')
  assert.equal(CAPABILITY_DETAIL_SHEET_QUERY, collapsed)
})

test('counts use the server total unless a plugin pill narrows the current page', () => {
  assert.deepEqual(capabilityCountSummary({ pageCount: 25, visibleCount: 25, total: 40 }), { count: 40, pageOnly: false, ownerCountsPageOnly: true })
  assert.deepEqual(capabilityCountSummary({ pageCount: 25, visibleCount: 15, total: 40, ownerFilter: 'alpha' }), { count: 15, pageOnly: true, ownerCountsPageOnly: true })
  assert.deepEqual(capabilityCountSummary({ pageCount: 12, visibleCount: 5, total: 12, ownerFilter: 'alpha' }), { count: 5, pageOnly: false, ownerCountsPageOnly: false }, 'a single page is exact')
  assert.deepEqual(capabilityCountSummary({ pageCount: 12, visibleCount: 12 }), { count: 12, pageOnly: false, ownerCountsPageOnly: false })
  assert.deepEqual(capabilityCountSummary({ pageCount: 12, visibleCount: 12, total: 3 }), { count: 12, pageOnly: false, ownerCountsPageOnly: false }, 'a stale smaller total never undercounts the page')
})

// --- CapabilityExplorer rendered through a minimal hooks runtime ---
const source = await read('pages/introspection/CapabilityExplorer.tsx')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function createRuntime() {
  const slots = []
  let cursor = 0, dirty = false, pending = [], renderFn, value
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((entry, index) => !Object.is(entry, b[index]))
  const api = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true } }]
    },
    useMemo(factory, deps) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: factory() }
      return slots[i].value
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect(effect, deps) {
      const i = cursor++
      const previous = slots[i]
      if (!previous || changed(previous.deps, deps)) {
        slots[i] = { deps, cleanup: previous?.cleanup }
        pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  return {
    api,
    mount(fn) { renderFn = fn; return this.render() },
    render() {
      let guard = 0
      do {
        assert.ok(++guard < 50, 'render loop settles')
        dirty = false; cursor = 0; pending = []
        value = renderFn()
        for (const run of pending) run()
      } while (dirty)
      return value
    },
    get value() { return value },
  }
}

function loadExplorer(runtime, media) {
  const i18n = { t: (message, values) => locale.translate('zh-CN', message, values), locale: 'zh-CN' }
  const mocks = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '@zhin.js/client': { cn: (...names) => names.filter(Boolean).join(' ') },
    '../../i18n/locale.mjs': locale,
    '../../i18n': { useI18n: () => i18n },
    './masonry-layout.mjs': masonry,
    '../permission-link-model.mjs': permissionLink,
    './GalleryPreview': { GalleryPreview: 'gallery-preview' },
    './JsonViewer': { JsonViewer: 'json-viewer' },
    '../../contracts/zhin-console': { ENDPOINT_RPC: {} },
    '../../utils/console-rpc': { requestConsole: async () => ({}) },
    '../../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope' },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
    '../../components/ui/badge': { Badge: 'badge' },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/dialog': { Dialog: 'dialog', DialogContent: 'dialog-content', DialogTitle: 'dialog-title' },
    '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select-field' },
    '../../components/ui/sheet': { Sheet: 'sheet', SheetContent: 'sheet-content', SheetTitle: 'sheet-title', SheetDescription: 'sheet-description', SheetClose: 'sheet-close' },
    '../../components/ui/list-item-button': { ListItemButton: 'list-item-button' },
    '../../hooks/useMediaQuery': { useMediaQuery: query => { assert.equal(query, CAPABILITY_DETAIL_SHEET_QUERY); return media.narrow } },
    './empty-state.mjs': emptyState,
    './target-preview.mjs': targetPreview,
    './capability-layout-model.mjs': layoutModel,
    './component-gallery.css': {},
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    assert.fail(`unmocked import ${name}`)
  }, module, module.exports)
  return module.exports.CapabilityExplorer
}

const children = node => node && typeof node === 'object' && 'props' in node ? [node.props.children].flat(Infinity) : []
function findAll(node, match, found = []) {
  if (Array.isArray(node)) { for (const entry of node) findAll(entry, match, found); return found }
  if (!node || typeof node !== 'object' || !('props' in node)) return found
  if (match(node)) found.push(node)
  for (const child of children(node)) findAll(child, match, found)
  return found
}
const byName = name => node => typeof node.type === 'function' && node.type.name === name
const byClass = name => node => typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)
const textOf = node => children(node).map(child => typeof child === 'object' && child ? textOf(child) : child == null || child === false ? '' : String(child)).join('')

const commands = Array.from({ length: 25 }, (_, index) => ({ pattern: `cmd${index}`, plugin: index < 15 ? 'alpha' : 'beta', desc: `命令 ${index}` }))

function mountExplorer({ narrow = false, total = 40, items = commands } = {}) {
  const runtime = createRuntime()
  const media = { narrow }
  const CapabilityExplorer = loadExplorer(runtime, media)
  runtime.mount(() => CapabilityExplorer({ kind: 'commands', items, readOnly: false, total }))
  return { runtime, media }
}
const catalog = tree => { const [node] = findAll(tree, byName('CommandCatalog')); assert.ok(node, 'the command list renders'); return node }
const sheetOf = tree => findAll(tree, node => node.type === 'sheet')[0]
const idOf = (tree, pattern) => catalog(tree).props.entries.find(entry => entry.item.pattern === pattern).id

test('wide screens keep the inline inspector next to the list and never open a sheet', () => {
  const { runtime } = mountExplorer({ narrow: false })
  assert.equal(sheetOf(runtime.value), undefined)
  const [inline] = findAll(runtime.value, byName('CapabilityInspector'))
  assert.equal(inline.props.item.pattern, 'cmd0', 'the first row is preselected as before')
  catalog(runtime.value).props.onSelect(idOf(runtime.value, 'cmd3')); runtime.render()
  assert.equal(sheetOf(runtime.value), undefined)
  assert.equal(findAll(runtime.value, byName('CapabilityInspector'))[0].props.item.pattern, 'cmd3')
})

test('narrow screens open the selected item in a detail sheet and return to the list', () => {
  const { runtime, media } = mountExplorer({ narrow: true })
  const closed = sheetOf(runtime.value)
  assert.ok(closed, 'narrow screens render the detail sheet instead of the inline inspector')
  assert.equal(closed.props.open, false, 'nothing opens until a row is chosen')
  const inspectors = findAll(runtime.value, byName('CapabilityInspector'))
  assert.ok(inspectors.every(node => findAll(closed, candidate => candidate === node).length), 'no inspector is stacked under the list')

  catalog(runtime.value).props.onSelect(idOf(runtime.value, 'cmd7')); runtime.render()
  const open = sheetOf(runtime.value)
  assert.equal(open.props.open, true)
  const [content] = findAll(open, node => node.type === 'sheet-content')
  assert.equal(content.props.side, 'right')
  assert.equal(findAll(content, byName('CapabilityInspector'))[0].props.item.pattern, 'cmd7')
  assert.ok(findAll(content, node => node.type === 'sheet-title').length, 'the sheet has an accessible name')
  const [back] = findAll(content, node => node.type === 'sheet-close')
  assert.ok(back, 'an explicit control returns to the list')
  assert.match(textOf(back), /返回列表/)
  assert.equal(locale.translate('en', '返回列表'), 'Back to list')

  open.props.onOpenChange(false); runtime.render()
  assert.equal(sheetOf(runtime.value).props.open, false, 'Esc, overlay and the back button close it')
  assert.equal(catalog(runtime.value).props.selectedId, idOf(runtime.value, 'cmd7'), 'the selection survives returning to the list')

  catalog(runtime.value).props.onSelect(idOf(runtime.value, 'cmd2')); runtime.render()
  media.narrow = false; runtime.render()
  assert.equal(sheetOf(runtime.value), undefined, 'widening shows the inline inspector again')
  assert.equal(findAll(runtime.value, byName('CapabilityInspector'))[0].props.item.pattern, 'cmd2')
  media.narrow = true; runtime.render()
  assert.equal(sheetOf(runtime.value).props.open, false, 'narrowing again does not reopen it')
})

test('the header shows the server total and plugin-filtered counts are labelled as this page only', () => {
  const { runtime } = mountExplorer({ total: 40 })
  const count = () => { const [node] = findAll(runtime.value, byClass('console-capability-count')); return { value: textOf(children(node)[0]), label: textOf(children(node)[1]) } }
  assert.deepEqual(count(), { value: '40', label: '项' }, 'the page carries 25 rows but the server reports 40')
  const [scope] = findAll(runtime.value, byClass('console-capability-owner-scope'))
  assert.ok(scope, 'the plugin bar says its counts cover this page only')
  assert.match(textOf(scope), /本页/)

  const pill = findAll(runtime.value, byClass('console-capability-owner-pill')).find(node => textOf(node).startsWith('alpha'))
  assert.equal(textOf(pill), 'alpha15')
  pill.props.onClick(); runtime.render()
  assert.deepEqual(count(), { value: '15', label: '项（本页）' }, 'a page-only plugin count never looks like a total')
  assert.equal(locale.translate('en', '项（本页）'), ' items (this page)')
  assert.equal(locale.translate('en', '本页统计'), 'This page')

  const single = mountExplorer({ total: 25 }).runtime
  assert.equal(findAll(single.value, byClass('console-capability-owner-scope')).length, 0, 'a complete single page needs no caveat')
  findAll(single.value, byClass('console-capability-owner-pill')).find(node => textOf(node).startsWith('beta')).props.onClick(); single.render()
  const [exact] = findAll(single.value, byClass('console-capability-count'))
  assert.equal(textOf(children(exact)[0]), '10')
  assert.equal(textOf(children(exact)[1]), '项')
})
