import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/ConversationSidebar.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function render(mobile, open, close = () => {}) {
  const module = { exports: {} }
  const mocks = {
    react: { useRef: () => ({ current: null }), useEffect() {} },
    '../../hooks/useIsMobile': { useIsMobile: () => mobile },
    '../../i18n': { useI18n: () => ({ t: value => value }) },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/input': { Input: 'input' },
    '../../components/ui/badge': { Badge: 'badge' },
    './AccountSwitcher': { AccountSwitcher: 'account-switcher' },
    './ConversationSection': { ConversationSection: 'conversation-section' },
    './SystemInboxSection': { SystemInboxSection: 'system-inbox-section' },
  }
  new Function('require', 'module', 'exports', compiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports.ConversationSidebar({ adapter: 'icqq', endpointId: 'preview', info: null, loadErr: null, listSearch: '', conversationSections: [], sectionCollapsed: {}, selection: null, requestCount: 0, noticeCount: 0, showChannelList: open, onCloseMobileList: close })
}

test('closed mobile conversation drawers are inert, while desktop lists remain available', () => {
  const closed = render(true, false)
  assert.equal(closed.props.inert, true)
  assert.equal(closed.props['aria-hidden'], true)
  const open = render(true, true)
  assert.equal(open.props.inert, false)
  assert.equal(open.props.role, 'dialog')
  assert.equal(open.props['aria-modal'], true)
  const desktop = render(false, false)
  assert.equal(desktop.props.inert, false)
  assert.equal(desktop.props.role, undefined)
})

test('mobile drawer Tab stays inside, and Escape respects a consumed event', () => {
  let closed = 0
  const drawer = render(true, true, () => { closed++ })
  const previousDocument = globalThis.document
  const targets = [0, 1].map(index => ({ tabIndex: 0, getClientRects: () => [index], focus() { globalThis.document.activeElement = this } }))
  globalThis.document = { activeElement: targets[1] }
  try {
    let prevented = false
    const event = { key: 'Tab', shiftKey: false, nativeEvent: {}, defaultPrevented: false, currentTarget: { querySelectorAll: () => targets }, preventDefault() { prevented = true } }
    drawer.props.onKeyDown(event)
    assert.equal(prevented, true)
    assert.equal(document.activeElement, targets[0])
    drawer.props.onKeyDown({ ...event, shiftKey: true })
    assert.equal(document.activeElement, targets[1])
    drawer.props.onKeyDown({ ...event, key: 'Escape', defaultPrevented: true })
    assert.equal(closed, 0)
    drawer.props.onKeyDown({ ...event, key: 'Escape', defaultPrevented: false })
    assert.equal(closed, 1)
  } finally { globalThis.document = previousDocument }
})
