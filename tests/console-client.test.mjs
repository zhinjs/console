import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as replyCapture from '../console-ui/src/utils/rpc-reply-capture.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function fixture() {
  const created = [], cleared = []
  let session = { apiBase: 'https://host-a.invalid', token: 'token-a' }
  const responses = []
  const app = { name: 'registry' }
  const sdk = {
    createConsoleApp: () => app,
    createConsoleClient: options => {
      const client = { options, connected: 0, app: options.app, disposedApp: false,
        transport: { disposed: false, dispose() { this.disposed = true } },
        connect() { this.connected++ }, dispose() { this.disposedApp = true } }
      created.push(client)
      return client
    },
  }
  const auth = {
    captureApiRequestContext: () => ({ ...session }), getApiBase: () => session.apiBase, getToken: () => session.token,
    clearRuntimeToken: () => cleared.push('runtime'), clearToken: () => { cleared.push('stored'); session = { ...session, token: null } },
    observeHostGatewayReply: response => observed.push(response.status),
  }
  const observed = []
  const module = { exports: {} }
  const globals = { window: {}, fetch: async () => responses.shift() }
  new Function('require', 'exports', 'module', 'window', 'fetch', compile(read('console-ui/src/utils/console-client.ts').replace('import.meta', '({ env: {} })')))(
    name => name === '@zhin.js/client' ? sdk : name === './auth' ? auth : name === './rpc-reply-capture.mjs' ? replyCapture : assert.fail(`unexpected dependency ${name}`),
    module.exports, module, globals.window, globals.fetch,
  )
  return { ...module.exports, created, cleared, observed, responses, registry: app, switchSession(next) { session = next } }
}

test('one connected client serves the session, and code outside React reads the same transport', () => {
  const f = fixture()
  const client = f.getConsoleClient()
  assert.equal(f.getConsoleClient(), client)
  assert.equal(f.getConsoleTransport(), client.transport)
  assert.equal(f.created.length, 1)
  assert.equal(client.connected, 1)
  assert.equal(f.app, f.registry)
  assert.equal(client.options.app, f.registry, 'the client registers plugin routes in the page-wide registry')
})

test('ending a session disposes its transport but keeps the route registry for the next one', () => {
  const f = fixture()
  const first = f.getConsoleClient()
  f.resetConsoleClient()
  assert.equal(first.transport.disposed, true)
  assert.equal(first.disposedApp, false, 'client.dispose() would also clear the built-in routes')
  const second = f.getConsoleClient()
  assert.notEqual(second, first)
  assert.equal(second.options.app, f.registry)
  assert.equal(second.connected, 1)
})

test('a 401 on a transport request drops the rejected credential, but not one that was already replaced', async () => {
  const f = fixture()
  const { fetch } = f.getConsoleClient().options.transportConfig
  f.responses.push({ status: 200 })
  await fetch('https://host-a.invalid/api/events')
  assert.deepEqual(f.cleared, [])

  f.responses.push({ status: 401 })
  const stale = fetch('https://host-a.invalid/api/console/request')
  f.switchSession({ apiBase: 'https://host-b.invalid', token: 'token-b' })
  await stale
  assert.deepEqual(f.cleared, [], 'a late answer from the previous Host must not sign the new session out')

  f.responses.push({ status: 401 })
  await fetch('https://host-b.invalid/api/console/request')
  assert.deepEqual(f.cleared, ['runtime', 'stored'])
})

test('every transport reply reaches the instance banner observer (instance_* replies of SDK reads)', async () => {
  const f = fixture()
  const { fetch } = f.getConsoleClient().options.transportConfig
  f.responses.push({ status: 503 }, { status: 200 })
  await fetch('https://host-a.invalid/api/console/request')
  await fetch('https://host-a.invalid/api/console/request')
  assert.deepEqual(f.observed, [503, 200], 'the observer filters by status itself')
})

test('the shell hands the session client to the SDK hooks and shows live connection state without a missed update', () => {
  const main = read('client/main.tsx')
  assert.match(main, /<ConsoleClientProvider client=\{client\}>/)
  assert.match(main, /React\.useState\(getConsoleClient\)/)
  const hook = read('console-ui/src/hooks/use-console-connected.ts')
  assert.match(hook, /useSyncExternalStore\(/)
  assert.match(hook, /transport\.onConnectionChange\(notify\)/)
  for (const path of ['console-ui/src/layouts/dashboard.tsx', 'console-ui/src/pages/dashboard.tsx', 'console-ui/src/pages/endpoint-detail/useEndpointConsole.tsx']) {
    const source = read(path)
    assert.match(source, /const connected = useConsoleConnected\(\)/, path)
    assert.doesNotMatch(source, /useConsoleTransport/, path)
  }
  assert.match(read('console-ui/src/utils/console-runtime.ts'), /resetConsoleClient\(\)/)
})
