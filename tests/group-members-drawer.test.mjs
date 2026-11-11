import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as panelModel from '../console-ui/src/pages/endpoint-detail/group-panel-model.mjs'
import * as draftModel from '../console-ui/src/pages/endpoint-detail/composer-draft-model.mjs'

const require = createRequire(import.meta.url)
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const { GROUP_PANEL_DRAWER_QUERY, memberDrawerAvailable, memberDrawerOpen, nextMemberDrawerTarget, shouldResetMemberDrawer } = panelModel

test('the drawer query is the exact complement of the CSS breakpoint that shows the member column', async () => {
  const css = await read('im-workspace.css')
  let breakpoint
  postcss.parse(css).walkRules(rule => {
    if (!rule.selectors.includes('.im-right-panel.im-right-visible')) return
    if (rule.parent?.type !== 'atrule' || rule.parent.name !== 'media') return
    let shown = false; rule.walkDecls('display', decl => { shown = decl.value === 'flex' })
    if (shown) breakpoint = /min-width:\s*(\d+)px/u.exec(rule.parent.params)?.[1]
  })
  assert.equal(breakpoint, '900', 'the member column is shown from 900px')
  assert.equal(GROUP_PANEL_DRAWER_QUERY, `not all and (min-width: ${breakpoint}px)`)
})

test('the narrow-screen entry exists only for a member-panel group on a narrow workspace', () => {
  assert.equal(memberDrawerAvailable({ showRightPanel: true, narrow: true }), true)
  assert.equal(memberDrawerAvailable({ showRightPanel: true, narrow: false }), false, 'wide screens keep the column')
  assert.equal(memberDrawerAvailable({ showRightPanel: false, narrow: true }), false, 'private chats and channels have no member panel')
  assert.equal(memberDrawerAvailable({ showRightPanel: undefined, narrow: true }), false)
})

test('the drawer is open only for the group it was opened in, and resets once it no longer applies', () => {
  const target = nextMemberDrawerTarget(true, 'A')
  assert.equal(target, 'A')
  assert.equal(nextMemberDrawerTarget(false, 'A'), null)
  assert.equal(nextMemberDrawerTarget(true, null), null)
  assert.equal(memberDrawerOpen(target, 'A', true), true)
  assert.equal(memberDrawerOpen(target, 'B', true), false, 'another conversation never shows it open')
  assert.equal(memberDrawerOpen(target, 'A', false), false, 'widening the window closes it')
  assert.equal(memberDrawerOpen(null, null, true), false)
  assert.equal(shouldResetMemberDrawer(target, 'A', true), false)
  assert.equal(shouldResetMemberDrawer(target, 'B', true), true)
  assert.equal(shouldResetMemberDrawer(target, 'A', false), true)
  assert.equal(shouldResetMemberDrawer(null, 'B', true), false, 'nothing to reset when closed')
})

// --- GroupMembersDrawer component (Sheet + trigger) ---
const drawerSource = await read('pages/endpoint-detail/GroupMembersDrawer.tsx')
const drawerCompiled = ts.transpileModule(drawerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const SheetTitle = 'sheet-title', SheetDescription = 'sheet-description'
function renderDrawer({ open, memberCount = 0, onOpenChange = () => {}, slots = [] }) {
  const module = { exports: {} }
  const mocks = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '../../i18n': { useI18n: () => ({ t: (message, values) => translate('zh-CN', message, values) }) },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/sheet': { Sheet: 'sheet', SheetContent: 'sheet-content', SheetTrigger: 'sheet-trigger', SheetTitle, SheetDescription },
  }
  new Function('require', 'module', 'exports', drawerCompiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports.GroupMembersDrawer({ open, memberCount, onOpenChange, children: s => { slots.push(s); return 'panel' } })
}
const kids = node => [node.props.children].flat()

test('the header entry is a labelled trigger that reports the drawer state', () => {
  const closed = renderDrawer({ open: false })
  assert.equal(closed.type, 'sheet')
  assert.equal(closed.props.open, false)
  const [trigger, content] = kids(closed)
  assert.equal(trigger.type, 'sheet-trigger')
  const button = trigger.props.children
  assert.equal(button.props['aria-label'], '群成员')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(button.props['aria-haspopup'], 'dialog')
  assert.equal(kids(button)[0].type, 'Users', 'the button carries an icon')
  assert.equal(content.type, 'sheet-content')
  assert.equal(content.props.side, 'right')

  const open = renderDrawer({ open: true, memberCount: 12 })
  const openButton = kids(open)[0].props.children
  assert.equal(open.props.open, true)
  assert.equal(openButton.props['aria-expanded'], true)
  assert.equal(openButton.props['aria-label'], '群成员（12）')
  assert.equal(translate('en', '群成员（{0}）', [12]), 'Group members (12)')
  assert.equal(translate('en', '群成员'), 'Group members')
})

test('the drawer renders the shared panel with Sheet title slots and closes through onOpenChange', () => {
  const changes = [], slots = []
  const drawer = renderDrawer({ open: true, onOpenChange: value => changes.push(value), slots })
  assert.equal(kids(drawer)[1].props.children, 'panel')
  assert.deepEqual(slots, [{ Title: SheetTitle, Description: SheetDescription }], 'the panel heading names the dialog')
  // Radix routes Esc, the overlay click and the close button through onOpenChange(false).
  drawer.props.onOpenChange(false)
  drawer.props.onOpenChange(true)
  assert.deepEqual(changes, [false, true])
})

// --- EndpointWorkspace drawer state ---
function hooks() {
  const slots = []; let cursor = 0, dirty = false, render, value
  const api = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true } }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
  }
  return {
    api,
    mount(fn) { render = fn; return this.render() },
    render() { let n = 0; do { assert.ok(++n < 50); dirty = false; cursor = 0; value = render() } while (dirty); return value },
    get value() { return value },
  }
}
async function workspaceLifecycle(bindings) {
  const file = 'pages/endpoint-detail/index.tsx', source = await read(file)
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration; (function find(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'EndpointWorkspace') declaration = n; ts.forEachChild(n, find) })(ast)
  assert.ok(declaration)
  let code = declaration.getText(ast); const stop = code.indexOf('  const handleDeleteFriend')
  assert.ok(stop > 0)
  code = code.slice(0, stop) + 'return { showMemberDrawer, memberDrawerIsOpen, setMemberDrawerIsOpen };}'
  code = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return Function('React', ...Object.keys(bindings), `${code};return EndpointWorkspace`)({ createElement: () => null }, ...Object.values(bindings))
}

test('opening, closing, switching conversation and widening the window drive the member drawer', async () => {
  const runtime = hooks()
  let ctx, narrow = true
  const EndpointWorkspace = await workspaceLifecycle({
    ...runtime.api, ...draftModel, ...panelModel, useMediaQuery: query => { assert.equal(query, GROUP_PANEL_DRAWER_QUERY); return narrow },
    useI18n: () => ({ t: value => value }), useEndpointConsole: () => ctx, isDemoMode: () => false,
    useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }), DEFAULT_MUTE_MINUTES: 10,
  })
  const group = id => ({ valid: true, selection: { type: 'channel', channelType: 'group', id, name: id }, showRightPanel: true, membersGroupKey: `group:${id}` })
  const privateChat = { valid: true, selection: { type: 'channel', channelType: 'private', id: 'p', name: 'p' }, showRightPanel: false, membersGroupKey: null }

  ctx = privateChat; runtime.mount(() => EndpointWorkspace())
  assert.equal(runtime.value.showMemberDrawer, false, 'no entry for a private chat')

  ctx = group('A'); runtime.render()
  assert.equal(runtime.value.showMemberDrawer, true)
  assert.equal(runtime.value.memberDrawerIsOpen, false)
  runtime.value.setMemberDrawerIsOpen(true); runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, true)
  runtime.value.setMemberDrawerIsOpen(false); runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, false, 'Esc / overlay / close button close it')

  runtime.value.setMemberDrawerIsOpen(true); runtime.render()
  ctx = group('B'); runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, false, 'switching to another group closes it')
  ctx = group('A'); runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, false, 'returning to the first group does not reopen it')

  runtime.value.setMemberDrawerIsOpen(true); runtime.render()
  ctx = privateChat; runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, false)
  assert.equal(runtime.value.showMemberDrawer, false)

  ctx = group('A'); runtime.render(); runtime.value.setMemberDrawerIsOpen(true); runtime.render()
  narrow = false; runtime.render()
  assert.equal(runtime.value.showMemberDrawer, false, 'wide screens show the column instead')
  narrow = true; runtime.render()
  assert.equal(runtime.value.memberDrawerIsOpen, false, 'narrowing again does not reopen it')
})

test('the page renders the entry in the conversation header and keeps the wide column unchanged', async () => {
  const page = await read('pages/endpoint-detail/index.tsx')
  const header = page.slice(page.indexOf('<header className="im-chat-header im-chat-header--channel'), page.indexOf('</header>'))
  assert.match(header, /\{showMemberDrawer && \(\s*<GroupMembersDrawer\s+open=\{memberDrawerIsOpen\}\s+onOpenChange=\{setMemberDrawerIsOpen\}/)
  assert.match(header, /renderMemberPanel\(Title, Description\)/)
  assert.match(page, /\{showRightPanel && !narrowWorkspace && \(\s*<aside className=\{cn\('im-right-panel im-right-visible'\)\}>\s*\{renderMemberPanel\('h3', 'p'\)\}/)
})
