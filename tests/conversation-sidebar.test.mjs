import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/ConversationSidebar.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''

function render(props = {}) {
  const module = { exports: {} }
  const mocks = {
    '../../i18n': { useI18n: () => ({ t: (value, values) => values ? value.replace('{0}', values[0]) : value }) },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/input': { Input: 'input' },
    './ConversationSection': { ConversationSection: 'conversation-section' },
    './SystemInboxSection': { SystemInboxSection: 'system-inbox-section' },
  }
  new Function('require', 'module', 'exports', compiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  const section = (id, count) => ({ id, title: id, entries: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, name: `${id} ${index}`, channelType: id, unreadCount: 0 })) })
  return module.exports.ConversationSidebar({ loadErr: null, listLoading: false, listNotice: null, listSearch: '', conversationSections: [section('private', 1), section('group', 2)],
    sectionCollapsed: {}, systemSectionCollapsed: false, selection: null, requestCount: 0, noticeCount: 0, onRefresh() {}, ...props })
}

test('the account chat list is a labelled navigation region, not a modal drawer', () => {
  const tree = render()
  assert.equal(tree.type, 'nav')
  assert.equal(tree.props['aria-label'], '会话列表')
  assert.equal(tree.props.role, undefined)
  assert.equal(tree.props.inert, undefined, 'a phone shows it as a pane, so it is never inert')
  assert.match(text(nodes(tree).find(node => node.type === 'h2')), /会话\s*3/, 'the heading counts the conversations')
  assert.equal(nodes(tree).some(node => node.type === 'account-switcher'), false, 'switching accounts is the page header scope picker')
  assert.equal(nodes(tree).some(node => /测试连接/.test(text(node))), false, 'the connection test lives in the 接入 tab')
})

test('refresh is labelled and disabled while the list loads; account status errors are announced', () => {
  const refresh = tree => nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '刷新列表')
  assert.equal(refresh(render()).props.disabled, false)
  const loading = render({ listLoading: true })
  assert.equal(refresh(loading).props.disabled, true)
  assert.ok(nodes(loading).some(node => node.props?.role === 'status'))
  const failed = render({ loadErr: 'HTTP 503' })
  const alert = nodes(failed).find(node => node.props?.role === 'alert')
  assert.match(text(alert), /HTTP 503/)
})
