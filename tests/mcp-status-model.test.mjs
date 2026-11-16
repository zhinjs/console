import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as locale from '../console-ui/src/i18n/locale.mjs'
import * as mcp from '../console-ui/src/pages/introspection/mcp-status-model.mjs'
import { deriveFallbackAttention } from '../console-ui/src/pages/attention/attention-model.mjs'

const require = createRequire(import.meta.url)
const read = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const { mcpRowState, readMcpTestResponse, mcpTestPresentation, mcpTestRequestError, countFailedMcp, isStdioMcp, MCP_CONFIG_HREF } = mcp

// --------------------------------------------------------------- row status

test('idle and not_loaded are neutral states; only failed is red', () => {
  const idle = mcpRowState({ name: 'fs', connected: false, toolCount: 0, status: 'idle' })
  assert.equal(idle.status, 'idle')
  assert.equal(idle.label, '待连接')
  assert.equal(idle.tone, 'secondary')
  assert.equal(idle.dot, 'is-idle')
  const notLoaded = mcpRowState({ name: 'fs', connected: false, toolCount: 0, status: 'not_loaded' })
  assert.equal(notLoaded.label, '未加载')
  assert.equal(notLoaded.dot, 'is-idle')
  for (const state of [idle, notLoaded]) {
    assert.notEqual(state.tone, 'destructive', `${state.status} is not a failure`)
    assert.notEqual(state.dot, 'is-offline')
  }
  const connected = mcpRowState({ name: 'fs', connected: true, toolCount: 4, status: 'connected' })
  assert.deepEqual([connected.label, connected.tone, connected.dot, connected.detail], ['已连接', 'success', 'is-online', '4 个可用工具'])
  assert.equal(mcpRowState(idle, 'en').label, 'Waiting to connect')
})

test('failed rows show the failure category, the exit code and the redacted reason', () => {
  const failed = mcpRowState({
    name: 'local', connected: false, toolCount: 0, status: 'failed', transport: 'stdio',
    lastError: { category: 'process_exit', message: 'spawn exited before handshake', exitCode: 127, at: 1_700_000_000_000 },
  })
  assert.equal(failed.tone, 'destructive')
  assert.equal(failed.dot, 'is-offline')
  assert.equal(failed.label, '连接失败')
  assert.equal(failed.detail, '进程已退出（退出码 127）：spawn exited before handshake')
  assert.deepEqual(failed.failure, { category: 'process_exit', message: 'spawn exited before handshake', exitCode: 127, at: 1_700_000_000_000 })
  assert.equal(mcpRowState({ status: 'failed', lastError: { category: 'auth', message: '401', at: 1 } }, 'en').detail, 'Authentication failed: 401')
  // Unknown category or no lastError still reads as a failure, never as success.
  assert.equal(mcpRowState({ status: 'failed', lastError: { category: 'weird', message: '' } }).detail, '未知原因')
  assert.equal(mcpRowState({ status: 'failed' }).detail, '连接失败，原因未报告')
})

test('rows of older instances (no status) keep the connected boolean', () => {
  assert.equal(mcpRowState({ name: 'a', connected: true, toolCount: 2 }).status, 'connected')
  const old = mcpRowState({ name: 'b', connected: false, toolCount: 0, error: 'ECONNREFUSED' })
  assert.deepEqual([old.status, old.label, old.detail], ['disconnected', '未连接', 'ECONNREFUSED'])
  assert.equal(mcpRowState({ name: 'c', connected: false }).detail, '连接不可用')
  assert.equal(mcpRowState({ status: 'bogus', connected: true }).status, 'connected', 'an unknown status falls back to the boolean')
})

test('stdio is recognised from the transport field', () => {
  assert.equal(isStdioMcp({ transport: 'stdio' }), true)
  assert.equal(isStdioMcp({ transport: ' STDIO ' }), true)
  assert.equal(isStdioMcp({ transport: 'streamable-http' }), false)
  assert.equal(isStdioMcp({}), false)
})

// ------------------------------------------------------------ test response

test('a 200 reply carries the throw-away test result', () => {
  const ok = readMcpTestResponse({ status: 200, body: { success: true, data: { ok: true, name: 'fs', toolCount: 3, durationMs: 41.6 } } })
  assert.deepEqual(ok, { kind: 'result', result: { ok: true, name: 'fs', toolCount: 3, durationMs: 41.6 } })
  assert.deepEqual(mcpTestPresentation(ok), { tone: 'success', role: 'status', label: '测试连接成功', detail: '列出 3 个工具 · 用时 42 ms' })

  const failed = readMcpTestResponse({ status: 200, body: { success: true, data: { ok: false, name: 'fs', failure: { category: 'timeout', message: 'no reply in 10s', at: 5 }, durationMs: 10_000 } } })
  assert.equal(failed.kind, 'result')
  assert.equal(failed.result.ok, false)
  const shown = mcpTestPresentation(failed)
  assert.equal(shown.tone, 'destructive')
  assert.equal(shown.role, 'alert')
  assert.equal(shown.detail, '连接超时：no reply in 10s · 用时 10000 ms')
  // A malformed body is never reported as a passing test.
  assert.equal(readMcpTestResponse({ status: 200, body: { success: true, data: {} } }).kind, 'error')
})

test('each documented error status gets its own explanation', () => {
  const reasons = Object.fromEntries([403, 404, 409, 429, 503, 500].map(status => [status, readMcpTestResponse({ status, body: { success: false, error: `E${status}` } }).reason]))
  assert.deepEqual(reasons, { 403: 'forbidden', 404: 'not_found', 409: 'busy', 429: 'rate_limited', 503: 'agent_unavailable', 500: 'error' })
  assert.equal(mcpTestPresentation(readMcpTestResponse({ status: 404, body: {} })).label, '配置里没有这个服务')
  assert.equal(mcpTestPresentation(readMcpTestResponse({ status: 409, body: {} })).label, '正在测试')
  assert.equal(mcpTestPresentation(readMcpTestResponse({ status: 503, body: {} })).label, 'Agent 未运行')
  assert.match(mcpTestPresentation(readMcpTestResponse({ status: 403, body: {} })).detail, /只读/)
  assert.equal(mcpTestPresentation(readMcpTestResponse({ status: 403, body: { error: '演示实例只读' } })).detail, '演示实例只读')
  assert.equal(mcpTestPresentation(readMcpTestResponse({ status: 500, body: {} })).detail, 'Host 返回 HTTP 500。')
  assert.equal(mcpTestPresentation(mcpTestRequestError('Failed to fetch')).detail, 'Failed to fetch')
})

test('429 tells how many seconds to wait from Retry-After (seconds or HTTP date)', () => {
  const seconds = readMcpTestResponse({ status: 429, body: { success: false }, retryAfter: '5' })
  assert.equal(seconds.retryAfterSec, 5)
  assert.match(mcpTestPresentation(seconds).detail, /请 5 秒后再试/)
  assert.match(mcpTestPresentation(seconds, 'en').detail, /Try again in 5 s/)
  const now = Date.UTC(2026, 10, 16, 0, 0, 0)
  const date = readMcpTestResponse({ status: 429, body: {}, retryAfter: new Date(now + 2_500).toUTCString(), now })
  assert.equal(date.retryAfterSec, 2)
  const unknown = readMcpTestResponse({ status: 429, body: {}, retryAfter: null })
  assert.equal(unknown.retryAfterSec, null)
  assert.match(mcpTestPresentation(unknown).detail, /请稍后再试/)
  assert.equal(readMcpTestResponse({ status: 503, body: {}, retryAfter: '9' }).retryAfterSec, null, 'only 429 reads Retry-After')
})

// ------------------------------------------------------------- attention

test('the attention fallback counts only failed servers when rows report status', () => {
  const rows = [
    { name: 'a', connected: false, status: 'idle' },
    { name: 'b', connected: false, status: 'not_loaded' },
    { name: 'c', connected: true, status: 'connected' },
  ]
  assert.equal(countFailedMcp(rows), 0)
  assert.equal(countFailedMcp([...rows, { name: 'd', connected: false, status: 'failed' }]), 1)
  assert.equal(countFailedMcp([{ name: 'old', connected: false }]), null, 'older instances keep the connected count')
  const stats = { endpoints: { total: 1, online: 1 } }
  const quiet = deriveFallbackAttention({ stats, errorLogs: 0, warningLogs: 0, mcpServices: 3, connectedMcp: 1, failedMcp: 0 })
  assert.deepEqual(quiet.map(item => item.kind), [], 'servers waiting to connect are not a problem')
  const failed = deriveFallbackAttention({ stats, errorLogs: 0, warningLogs: 0, mcpServices: 3, connectedMcp: 1, failedMcp: 1 })
  assert.deepEqual(failed.map(item => [item.kind, item.title]), [['mcp.disconnected', '1 个 MCP 服务连接失败']])
  const legacy = deriveFallbackAttention({ stats, errorLogs: 0, warningLogs: 0, mcpServices: 3, connectedMcp: 1 })
  assert.deepEqual(legacy.map(item => [item.kind, item.title]), [['mcp.disconnected', '2 个 MCP 服务未连接']])
})

test('Host attention items for MCP are rendered with the title and detail the Host sent', async () => {
  const model = await read('pages/attention/attention-model.mjs')
  // The only Console-authored MCP copy is the fallback for Hosts without attention.list.
  assert.equal(model.match(/MCP 服务(?:未连接|连接失败)/g)?.length, 2)
  assert.match(model, /function deriveFallbackAttention/)
  const row = await read('pages/attention/AttentionItemRow.tsx')
  assert.doesNotMatch(row, /mcp\.disconnected/, 'no MCP-specific wording is spliced into Host items')
})

// ------------------------------------------------------------- contract

test('the local contract mirror matches the REST path and the published protocol once it ships', async () => {
  const contract = await read('contracts/mcp.ts')
  assert.match(contract, /export const CONSOLE_MCP_TEST_PATH = '\/introspection\/mcp\/test'/)
  for (const status of ['connected', 'failed', 'idle', 'not_loaded']) assert.match(contract, new RegExp(`'${status}'`))
  for (const category of mcp.MCP_FAILURE_CATEGORIES) assert.match(contract, new RegExp(`'${category}'`))
  assert.deepEqual([...mcp.MCP_SERVER_STATUSES], ['connected', 'failed', 'idle', 'not_loaded'])
  const rest = await read('contracts/zhin-console.ts')
  assert.match(rest, /MCP_TEST: '\/api\/introspection\/mcp\/test'/)
  const protocol = await import('@zhin.js/console-protocol')
  if ('CONSOLE_MCP_TEST_PATH' in protocol) {
    assert.equal(protocol.CONSOLE_MCP_TEST_PATH, '/introspection/mcp/test', 'switch contracts/mcp.ts to re-export the protocol')
  }
  assert.equal(MCP_CONFIG_HREF, '/ops/config?section=ai%3Aservices')
})

// ------------------------------------------------------------- detail panel

const detailSource = await read('pages/introspection/McpServerDetail.tsx')
const detailCompiled = ts.transpileModule(detailSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

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

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node !== 'object' ? String(node) : text(node.props?.children)

function mountDetail(item, { permissions = ['agent.configure', 'ops.config.read'], reply } = {}) {
  const runtime = createRuntime()
  const requests = []
  const i18n = { t: (message, values) => locale.translate('zh-CN', message, values), locale: 'zh-CN' }
  const mocks = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '../../i18n': { useI18n: () => i18n },
    '../../contracts/zhin-console': { CONSOLE_REST: { MCP_TEST: '/api/introspection/mcp/test' } },
    '../../utils/auth': {
      apiFetch: async (path, init) => {
        requests.push({ path, init })
        const { status = 200, body = {}, retryAfter = null } = await reply()
        return { status, ok: status < 300, json: async () => body, headers: { get: name => name === 'retry-after' ? retryAfter : null } }
      },
    },
    '../../utils/console-access.mjs': { hasConsolePermission: name => permissions.includes(name) },
    '../../hooks/use-console-access': { useConsoleAccess: () => ({}) },
    '../../components/ui/alert': { Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description' },
    '../../components/ui/button': { Button: 'button' },
    './mcp-status-model.mjs': mcp,
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', detailCompiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    return require(name)
  }, module, module.exports)
  const { McpServerDetail } = module.exports
  runtime.mount(() => McpServerDetail({ item }))
  const testButton = () => nodes(runtime.value).find(node => node.type === 'button' && /测试/.test(text(node)))
  return { runtime, requests, testButton }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('the test button needs agent.configure; the configuration link points at ai.mcpServers', () => {
  const item = { name: 'fs', connected: false, toolCount: 0, status: 'idle', transport: 'streamable-http' }
  const viewer = mountDetail(item, { permissions: ['ops.config.read'] })
  assert.equal(viewer.testButton(), undefined, 'without agent.configure there is no test button')
  const link = nodes(viewer.runtime.value).find(node => node.type === 'a')
  assert.equal(link.props.to, '/ops/config?section=ai%3Aservices')
  assert.match(text(link), /ai\.mcpServers/)
  const none = mountDetail(item, { permissions: [] })
  assert.equal(nodes(none.runtime.value).find(node => node.type === 'a'), undefined, 'no configuration link without ops.config.read')

  const operator = mountDetail(item)
  assert.ok(operator.testButton(), 'agent.configure shows the button')
  assert.doesNotMatch(text(operator.runtime.value), /另起一个进程/, 'non-stdio servers have no process warning')
})

test('stdio servers warn that the test starts another process', () => {
  const { runtime } = mountDetail({ name: 'local', connected: true, toolCount: 1, status: 'connected', transport: 'stdio' })
  const note = nodes(runtime.value).find(node => node.type === 'alert' && /另起一个进程/.test(text(node)))
  assert.ok(note, 'the stdio warning is shown next to the button')
  assert.match(text(note), /独占资源的服务.*可能.*冲突/)
})

test('a test posts { name } and shows its result apart from the row status', async () => {
  const item = { name: 'fs', connected: false, toolCount: 0, status: 'failed', lastError: { category: 'network', message: 'ECONNREFUSED', at: 1 } }
  const { runtime, requests, testButton } = mountDetail(item, { reply: async () => ({ body: { success: true, data: { ok: true, name: 'fs', toolCount: 2, durationMs: 12 } } }) })
  const before = text(runtime.value)
  assert.match(before, /网络不可达：ECONNREFUSED/)
  testButton().props.onClick(); runtime.render()
  assert.equal(testButton().props.disabled, true, 'the button is disabled while the test runs')
  await flush(); runtime.render()
  assert.deepEqual(requests.map(request => [request.path, request.init.method, JSON.parse(request.init.body)]), [['/api/introspection/mcp/test', 'POST', { name: 'fs' }]])
  const result = nodes(runtime.value).find(node => node.type === 'alert' && node.props.variant === 'success')
  assert.ok(result, 'the test result is its own block')
  assert.match(text(result), /测试连接成功/)
  assert.match(text(result), /列出 2 个工具/)
  assert.match(text(runtime.value), /网络不可达：ECONNREFUSED/, 'the row status from the list stays as it was')
  assert.equal(testButton().props.disabled, false)
})

test('429 from the test shows how long to wait', async () => {
  const { runtime, testButton } = mountDetail({ name: 'fs', status: 'idle' }, { reply: async () => ({ status: 429, body: { success: false, error: 'busy' }, retryAfter: '4' }) })
  testButton().props.onClick(); await flush(); runtime.render()
  const result = nodes(runtime.value).find(node => node.type === 'alert' && node.props.variant === 'warning')
  assert.match(text(result), /请 4 秒后再试/)
})
