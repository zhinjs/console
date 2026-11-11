import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as model from '../console-ui/src/pages/endpoint-test-result-model.mjs'

const { readEndpointTestResult, endpointTestError, endpointTestPresentation } = model
const require = createRequire(import.meta.url)

test('connection test keeps the structured reachable result instead of a pre-joined string', () => {
  assert.deepEqual(readEndpointTestResult({ reachable: true, connected: true, status: 'online', latencyMs: 24, message: 'Endpoint 已连接' }),
    { ok: true, connected: true, status: 'online', latencyMs: 24, message: 'Endpoint 已连接' })
  const offline = readEndpointTestResult({ reachable: false, connected: false, latencyMs: 3, message: 'Endpoint 当前离线' })
  assert.equal(offline.ok, false)
  assert.equal(offline.message, 'Endpoint 当前离线')
  // Missing or malformed reachability is never reported as a success.
  for (const payload of [undefined, null, {}, { reachable: 'true' }, { message: 'ok' }]) assert.equal(readEndpointTestResult(payload).ok, false)
  assert.equal(readEndpointTestResult({ connected: true }).ok, true)
  assert.equal(readEndpointTestResult({ reachable: true, latencyMs: -1 }).latencyMs, undefined)
  assert.deepEqual(endpointTestError('测试失败：timeout'), { ok: false, message: '测试失败：timeout' })
})

test('successful and failed tests present different tones, roles and reasons', () => {
  const ok = endpointTestPresentation({ ok: true, latencyMs: 24, message: 'Endpoint 已连接' })
  assert.deepEqual(ok, { tone: 'success', role: 'status', label: '连接正常', reason: undefined, latencyText: '24 ms', detail: 'Endpoint 已连接 · 24 ms' })
  const failed = endpointTestPresentation({ ok: false, latencyMs: 5, message: 'Endpoint 当前离线' })
  assert.equal(failed.tone, 'error')
  assert.equal(failed.role, 'alert')
  assert.equal(failed.label, '连接失败')
  assert.equal(failed.reason, 'Endpoint 当前离线')
  assert.equal(failed.detail, 'Endpoint 当前离线 · 5 ms')
  assert.equal(endpointTestPresentation({ ok: false }).reason, '连接异常')
  // The host reports "connected" but not online: the reason must not read like success.
  const degraded = endpointTestPresentation({ ok: false, connected: true, status: 'pending', message: 'Endpoint 已连接' })
  assert.equal(degraded.reason, '已连接，但运行状态为 pending')
  assert.equal(endpointTestPresentation({ ok: false, message: 'Endpoint 当前离线' }, 'en').label, 'Connection failed')
  assert.equal(endpointTestPresentation({ ok: true }, 'en').label, 'Connected')
})

const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/ConversationSidebar.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function renderSidebar(props) {
  const module = { exports: {} }
  const mocks = {
    react: { useRef: () => ({ current: null }), useEffect() {} },
    '../../hooks/useIsMobile': { useIsMobile: () => false },
    '../../i18n': { useI18n: () => ({ t: value => value, locale: 'zh-CN' }) },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../components/ui/button': { Button: 'button' },
    '../../components/ui/input': { Input: 'input' },
    './AccountSwitcher': { AccountSwitcher: 'account-switcher' },
    './ConversationSection': { ConversationSection: 'conversation-section' },
    './SystemInboxSection': { SystemInboxSection: 'system-inbox-section' },
    '../endpoint-test-result-model.mjs': model,
  }
  new Function('require', 'module', 'exports', compiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports.ConversationSidebar({ adapter: 'icqq', endpointId: 'preview', info: null, loadErr: null, listSearch: '', conversationSections: [], sectionCollapsed: {}, selection: null, requestCount: 0, noticeCount: 0, showChannelList: true, testLoading: false, testMessage: null, ...props })
}

function walk(node, visit) {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (!node || typeof node !== 'object' || !node.props) return
  visit(node)
  walk(node.props.children, visit)
}
function findAll(tree, predicate) { const found = []; walk(tree, node => { if (predicate(node)) found.push(node) }); return found }
function text(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text(node.props?.children)
}

test('sidebar shows a failed test as a destructive alert with a cross icon and the reason', () => {
  const tree = renderSidebar({ testMessage: { ok: false, latencyMs: 4, message: 'Endpoint 当前离线' } })
  const [region] = findAll(tree, node => node.props.role === 'alert' || node.props.role === 'status')
  assert.ok(region, 'test result region has a live role')
  assert.equal(region.props.role, 'alert')
  assert.match(region.props.className, /text-destructive/)
  assert.doesNotMatch(region.props.className, /text-muted-foreground/)
  assert.equal(findAll(region, node => node.type === 'XCircle').length, 1)
  assert.match(text(region), /连接失败/)
  assert.match(text(region), /Endpoint 当前离线/)
})

test('sidebar shows a successful test as a success status with a check icon', () => {
  const tree = renderSidebar({ testMessage: { ok: true, latencyMs: 24, message: 'Endpoint 已连接' } })
  const [region] = findAll(tree, node => node.props.role === 'alert' || node.props.role === 'status')
  assert.ok(region)
  assert.equal(region.props.role, 'status')
  assert.match(region.props.className, /text-success/)
  assert.equal(findAll(region, node => node.type === 'CheckCircle2').length, 1)
  assert.match(text(region), /连接正常/)
  assert.match(text(region), /24 ms/)
})

test('sidebar test button is disabled and labelled while a test runs', () => {
  const tree = renderSidebar({ testLoading: true })
  const [button] = findAll(tree, node => node.type === 'button' && /测试/.test(text(node)))
  assert.equal(button.props.disabled, true)
  assert.match(text(button), /测试中…/)
  assert.equal(findAll(renderSidebar({}), node => node.props.role === 'alert' || node.props.role === 'status').length, 0)
})

test('endpoint cards announce test results and label the running state', async () => {
  const list = await readFile(new URL('../console-ui/src/pages/endpoints.tsx', import.meta.url), 'utf8')
  assert.match(list, /endpointTestPresentation\(/)
  assert.match(list, /role=\{presentation\.role\}/)
  assert.match(list, /i18n\.t\("测试中…"\)/)
  assert.doesNotMatch(list, /测速中/)
})
