import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { createHostRegistration } from '../console-ui/src/bootstrap/host-registration.mjs'

// Exercise production component functions with inert reader components. Existing
// history/trace boundary tests retain responsibility for HTTP parsing and paging.
async function loadComponents(path, bindings, names = []) {
  const file = new URL(`../console-ui/src/${path}`, import.meta.url)
  const ast = ts.createSourceFile(file.pathname, await readFile(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const source = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => ts.createPrinter().printNode(ts.EmitHint.Unspecified, statement, ast)).join('\n')
  const code = ts.transpileModule(source + names.map(name => `\nexport { ${name} };`).join(''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const exports = {}
  Function('exports', 'React', ...Object.keys(bindings), code)(exports, React, ...Object.values(bindings))
  return exports
}

function children(element, type) {
  if (!React.isValidElement(element)) return []
  const values = React.Children.toArray(element.props.children)
  return [ ...(element.type === type ? [element] : []), ...values.flatMap(value => children(value, type)) ]
}

function states() {
  let cursor = 0
  const values = []
  return {
    render(component, props) { cursor = 0; return component(props) },
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
    },
  }
}

test('only the actual Sandbox element receives a lazy optional reader without changing route permissions or page props', async () => {
  const Reader = () => { throw Error('reader must not mount during registration') }
  const { withSandboxConversationDetails } = await loadComponents('bootstrap/sandbox-conversation-details.tsx', {
    cloneElement: React.cloneElement, isValidElement: React.isValidElement, SandboxConversationDetails: Reader,
  })
  function OldSandbox() { return React.createElement('p', null, 'legacy conversation') }
  const route = { path: '/sandbox', element: React.createElement(OldSandbox, { key: 'stable', existing: 'kept' }),
    requiredPermissions: ['existing-permission'], meta: { group: '会话' } }
  const wrapped = withSandboxConversationDetails(route)
  assert.notEqual(wrapped, route)
  assert.equal(wrapped.element.type, route.element.type)
  assert.equal(wrapped.element.key, 'stable')
  assert.equal(wrapped.element.props.existing, 'kept')
  assert.equal(wrapped.requiredPermissions, route.requiredPermissions)
  assert.equal(wrapped.meta, route.meta)
  assert.equal(route.element.props.renderConversationDetails, undefined)
  assert.equal(renderToStaticMarkup(wrapped.element), '<p>legacy conversation</p>')
  const details = wrapped.element.props.renderConversationDetails({ sessionKey: 'sandbox:bot:group:room', canExecute: true, connectionId: 'live-connection' })
  assert.equal(details.type, Reader)
  assert.deepEqual(details.props, { sessionKey: 'sandbox:bot:group:room', canExecute: true, connectionId: 'live-connection' })
  for (const unchanged of [{ ...route, path: '/calendar' }, { ...route, element: null }]) {
    assert.equal(withSandboxConversationDetails(unchanged), unchanged)
  }
})

test('wrapped dynamic pages remain owned by the captured Host epoch', async () => {
  const { withSandboxConversationDetails } = await loadComponents('bootstrap/sandbox-conversation-details.tsx', {
    cloneElement: React.cloneElement, isValidElement: React.isValidElement, SandboxConversationDetails: 'Reader',
  })
  let routes = []
  const host = createHostRegistration({ readRoutes: () => routes,
    addRoute: route => { routes = [...routes.filter(row => row.path !== route.path), route] },
    removeRoute: path => { routes = routes.filter(row => row.path !== path) }, addTool: () => 'unused' })
  const old = host.capture(), route = { path: '/sandbox', element: React.createElement(() => null) }
  old.addRoute(withSandboxConversationDetails(route))
  assert.equal(typeof routes[0].element.props.renderConversationDetails, 'function')
  host.reset()
  old.addRoute(withSandboxConversationDetails(route))
  assert.deepEqual(routes, [])
})

test('DOM and React builtin elements stay unchanged while memo and forwardRef components accept the optional renderer', async () => {
  const { withSandboxConversationDetails } = await loadComponents('bootstrap/sandbox-conversation-details.tsx', {
    cloneElement: React.cloneElement, isValidElement: React.isValidElement, SandboxConversationDetails: 'Reader',
  })
  for (const type of ['div', React.Fragment, React.StrictMode, React.Suspense]) {
    const route = { path: '/sandbox', element: React.createElement(type) }
    assert.equal(withSandboxConversationDetails(route), route)
    assert.equal(route.element.props.renderConversationDetails, undefined)
  }
  const Component = () => null
  for (const type of [React.memo(Component), React.forwardRef(Component)]) {
    const route = { path: '/sandbox', element: React.createElement(type) }
    const wrapped = withSandboxConversationDetails(route)
    assert.equal(wrapped.element.type, type)
    assert.equal(typeof wrapped.element.props.renderConversationDetails, 'function')
  }
})

test('a page-provided renderer is preserved and the shell only fills an undefined optional prop', async () => {
  const { withSandboxConversationDetails } = await loadComponents('bootstrap/sandbox-conversation-details.tsx', {
    cloneElement: React.cloneElement, isValidElement: React.isValidElement, SandboxConversationDetails: 'Reader',
  })
  function SandboxPage() { return null }
  const renderer = () => React.createElement('p', null, 'page-owned reader')
  for (const provided of [renderer, null]) {
    const route = { path: '/sandbox', element: React.createElement(SandboxPage, { renderConversationDetails: provided }) }
    assert.equal(withSandboxConversationDetails(route), route)
    assert.equal(route.element.props.renderConversationDetails, provided)
  }
  const route = { path: '/sandbox', element: React.createElement(SandboxPage, { renderConversationDetails: undefined }) }
  assert.equal(typeof withSandboxConversationDetails(route).element.props.renderConversationDetails, 'function')
})

test('read-only connections and Demo never mount history or trace readers', async () => {
  let demo = false
  const fail = () => { throw Error('unauthorized reader mounted') }
  const { SandboxConversationDetails } = await loadComponents('pages/SandboxConversationDetails.tsx', {
    isDemoMode: () => demo, useInboxCacheScope: fail, useConversationTraces: fail,
  })
  assert.equal(SandboxConversationDetails({ sessionKey: 'sandbox:bot:private:owner', canExecute: false }), null)
  demo = true
  assert.equal(SandboxConversationDetails({ sessionKey: 'sandbox:bot:private:owner', canExecute: true }), null)
  demo = false
  assert.equal(SandboxConversationDetails({ sessionKey: 'sandbox:bot:private:owner', canExecute: true, connectionId: 'live-connection' }).props.connectionId, 'live-connection')
})

test('the reading view reuses canonical history, binds traces to its resolved address and opens a selected turn from usage', async () => {
  const runtime = states(), calls = [], refreshes = []
  const traces = { turns: [], revision: 0, loading: false, error: null, refresh: () => refreshes.push('trace') }
  const { ConversationReader } = await loadComponents('pages/SandboxConversationDetails.tsx', {
    useState: runtime.useState,
    useI18n: () => ({ t: value => value }),
    useConversationTraces: (...args) => { calls.push(args); return traces },
    Tabs: 'Tabs', TabsContent: 'TabsContent', TabsList: 'TabsList', TabsTrigger: 'TabsTrigger',
    ConversationHistory: 'History', ConversationTrace: 'Trace',
  }, ['ConversationReader'])
  const props = { sessionKey: 'sandbox:bot:group:room', connectionScope: 'host-epoch', connectionId: 'live-socket' }
  let view = runtime.render(ConversationReader, props)
  const history = children(view, 'History')[0]
  assert.equal(history.props.sessionKey, props.sessionKey)
  assert.equal(history.props.connectionScope, props.connectionScope)
  assert.equal(history.props.connectionId, props.connectionId)
  assert.equal(children(view, 'TabsContent')[0].props.forceMount, true)
  assert.deepEqual(calls.at(-1), [props.sessionKey, props.connectionScope, undefined])
  const conversation = { endpoint: { adapter: 'root/sandbox', id: 'root/sandbox\0bot' }, kind: 'group', id: 'room', threadId: 'actual-thread' }
  history.props.onConversation(conversation)
  view = runtime.render(ConversationReader, props)
  assert.equal(calls.at(-1)[2], conversation)
  assert.equal(children(view, 'Trace')[0].props.conversation, conversation)
  children(view, 'History')[0].props.onOpenTrace('turn-from-usage')
  view = runtime.render(ConversationReader, props)
  assert.equal(view.props.value, 'trace')
  assert.equal(children(view, 'Trace')[0].props.selectedTurn, 'turn-from-usage')
  children(view, 'Trace')[0].props.refresh()
  assert.deepEqual(refreshes, ['trace'])
})

test('Host or scene changes remount the existing cancellable readers, while an inactive authority renders nothing', async () => {
  let scope = 'first-host', active = true
  const { ScopedConversationDetails } = await loadComponents('pages/SandboxConversationDetails.tsx', {
    useInboxCacheScope: () => scope, isInboxCacheScopeActive: () => active,
  }, ['ScopedConversationDetails'])
  const first = ScopedConversationDetails({ sessionKey: 'sandbox:bot:group:a' })
  const otherScene = ScopedConversationDetails({ sessionKey: 'sandbox:bot:group:b' })
  assert.notEqual(first.key, otherScene.key)
  assert.notEqual(first.key, ScopedConversationDetails({ sessionKey: 'sandbox:bot:group:a', connectionId: 'new-socket' }).key)
  scope = 'second-host'
  assert.notEqual(first.key, ScopedConversationDetails({ sessionKey: 'sandbox:bot:group:a' }).key)
  active = false
  assert.equal(ScopedConversationDetails({ sessionKey: 'sandbox:bot:group:a' }), null)
})
