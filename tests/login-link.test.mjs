import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as loginModel from '../console-ui/src/pages/login-model.mjs'

const middlewareSource = await readFile(new URL('../client/middleware/queryPrefill.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../client/main.tsx', import.meta.url), 'utf8')

function load({ href, stored = { token: null, apiBase: null } }) {
  const url = new URL(href), events = []
  const window = {
    location: { href: url.href, search: url.search },
    history: { state: null, replaceState: (_state, _title, next) => { events.push(['replace', next]); const u = new URL(next, url); window.location = { href: u.href, search: u.search } } },
  }
  const auth = {
    getStoredApiBase: () => stored.apiBase,
    reconcileAuthWithApiBase: incoming => {
      events.push(['reconcile', incoming])
      if (incoming && incoming !== stored.apiBase) return { authed: false, loginApiBase: incoming }
      return { authed: Boolean(stored.token && stored.apiBase), loginApiBase: incoming ?? (stored.token ? null : stored.apiBase) }
    },
  }
  const module = { exports: {} }
  const code = ts.transpileModule(middlewareSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mocks = { '@console/utils/auth': auth, '@console/pages/login-model.mjs': loginModel }
  new Function('require', 'exports', 'module', 'window', code)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] }, module.exports, module, window)
  return { middleware: module.exports, window, events }
}

test('opening a ?token= link removes the token from the address bar before anything else runs', () => {
  const { middleware, window, events } = load({ href: 'https://console.example/?apiBaseUrl=127.0.0.1:8086&token=link-secret&lang=en' })
  const link = middleware.takeLoginLink()
  assert.deepEqual(link, { apiBase: '127.0.0.1:8086', token: 'link-secret' })
  assert.equal(window.location.href, 'https://console.example/?lang=en')
  assert.ok(!window.location.href.includes('link-secret'))
  const session = middleware.runQueryPrefillMiddleware(link)
  assert.deepEqual(events[0], ['replace', '/?lang=en'])
  // The prefilled Host is normalized before it is compared with the stored session.
  assert.deepEqual(events[1], ['reconcile', 'http://127.0.0.1:8086'])
  assert.deepEqual(session, { authed: false, loginApiBase: 'http://127.0.0.1:8086', loginToken: 'link-secret' })
})

test('a token link opens the login page even when a stored session exists, and targets the stored Host', () => {
  const { middleware } = load({ href: 'https://console.example/?token=link-secret', stored: { token: 'old', apiBase: 'http://host-a:8086' } })
  assert.deepEqual(middleware.runQueryPrefillMiddleware(middleware.takeLoginLink()), { authed: false, loginApiBase: 'http://host-a:8086', loginToken: 'link-secret' })
})

test('without a token the existing Host-only prefill is unchanged', () => {
  const { middleware, window } = load({ href: 'https://console.example/?apiBaseUrl=http://host-b:8086/', stored: { token: 'old', apiBase: 'http://host-b:8086' } })
  assert.deepEqual(middleware.runQueryPrefillMiddleware(middleware.takeLoginLink()), { authed: true, loginApiBase: 'http://host-b:8086', loginToken: null })
  assert.equal(window.location.href, 'https://console.example/')
})

test('the token is taken from the address bar at startup, before the demo bootstrap can skip the login flow', () => {
  const take = mainSource.indexOf('takeLoginLink()'), demo = mainSource.indexOf('runDemoBootstrap()')
  assert.ok(take > 0 && demo > take, 'takeLoginLink() must run before runDemoBootstrap()')
  assert.match(mainSource, /initialToken=\{/)
})
