import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as personal from '../console-ui/src/pages/personal-session-model.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'

import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'

const key = `personal-session:v1:${'a'.repeat(64)}`
const secondKey = `personal-session:v1:${'b'.repeat(64)}`
const owner = subjectId => ({ rootId: '/host', platform: 'qq', endpoint: 'bot', adapterId: 'adapter', subjectId })
const address = subjectId => ({ rootId: '/host', platform: 'qq', endpoint: 'bot', subjectId,
  conversation: { endpoint: { adapter: 'qq', id: 'adapter' }, kind: 'private', id: subjectId } })
async function fixture({ actualPicker = false } = {}) {
  const runtime = pageRuntime(), calls = [], sent = [], transport = []
  const owners = [{ id: 'alice', personal: owner('alice') }, { id: 'bob', personal: owner('bob') }, { id: 'host' }]
  let scope = 'connection-a', sessionKey = key, selected = 'alice', epoch = 0, preferredOwnerId, viewReady = true
  const management = () => {
    const captured = { scope, selected, epoch }
    return { owners, ownerId: selected, view: viewReady ? { drivers: [], ownerId: selected, rootId: '/host', deployment: [], profiles: { profile: { id: 'profile', model: 'native', accountId: 'account' } }, accounts: { account: { serviceId: 'service', incarnation: 'new' } }, services: { service: { models: { native: { kinds: ['language'] } } } } } : null, error: '', busy: false,
      setOwnerId(id) { selected = id; epoch++ }, active: () => captured.scope === scope && captured.selected === selected && captured.epoch === epoch,
      request: path => new Promise((resolve, reject) => calls.push({ ...captured, path, resolve, reject })),
    }
  }
  async function load(path, dependencies) {
    const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const allDependencies = { react: runtime.api,
      './inference/SupportInfo': { SupportLabel: 'support-label', SupportNotice: 'support-notice', supportLabel: label => label },
      'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
      ...dependencies,
    }
    const module = { exports: {} }
    new Function('require', 'module', 'exports', code)(name => { assert.ok(name in allDependencies, name); return allDependencies[name] }, module, module.exports)
    return module.exports
  }
  const { PersonalSessionModelPicker: Picker } = actualPicker ? await load('../console-ui/src/pages/PersonalSessionModelPicker.tsx', {
    'lucide-react': { RefreshCw: 'icon' }, '../components/ui/button': { Button: 'button' },
    '../components/ui/select': { SelectField: 'select' }, '../components/error-alert': { ErrorAlert: 'error' },
    '../utils/inbox-cache': { isInboxCacheScopeActive: captured => captured === scope },
    './inference/model.mjs': model, './personal-session-model.mjs': personal,
    '../utils/auth': { apiFetch: async (url, init) => {
      transport.push({ url, init })
      const resolvedAddress = JSON.parse(new URL(url, 'https://fixture').searchParams.get('address'))
      return Response.json({ success: true, data: { identity: { key: sessionKey, address: resolvedAddress }, revision: 1,
        selection: { kind: 'profile', profile: { id: 'profile', rootId: '/host', accountId: 'account', accountIncarnation: 'old', kind: 'language' } } } })
    } },
  }) : {}
  const page = await load('../console-ui/src/pages/PersonalSessionPanel.tsx', {
    '../components/ui/select': { SelectField: 'select' }, '../components/error-alert': { ErrorAlert: 'error' },
    './inference/useInferenceManagement': { useInferenceManagement: management },
    './inference/model.mjs': { inferenceError: error => error.message },
    './PersonalSessionModelPicker': { PersonalSessionModelPicker: actualPicker ? Picker : props => ({ type: 'picker', props: { ...props, send: () => sent.push(props) } }) },
    './personal-session-model.mjs': personal,
  })
  runtime.mount(() => ({ type: page.PersonalSessionPanel, props: { sessionKey, connectionScope: scope, preferredOwnerId } }))
  return { runtime, calls, sent, transport,
    switchOwner(id) { selected = id; epoch++; runtime.render() },
    holdView() { viewReady = false; runtime.render() },
    showView() { viewReady = true; runtime.render() },
    switchSession(id) { sessionKey = id; runtime.render() },
    switchConnection() { scope = 'connection-b'; epoch++; runtime.render() },
    switchPreference() { preferredOwnerId = 'bob'; selected = 'bob'; epoch++; runtime.render() },
    answer(call, subject = call.selected, id = sessionKey) { call.resolve({ rows: [{ sessionKey: id, address: address(subject), updatedAt: 1 }], hasMore: false }) },
    picker() { return nodes(runtime.value).find(node => node.type === 'picker') },
  }
}

for (const target of ['host', 'missing', 'bob', 'session', 'connection', 'preference'])
  test(`personal page owns every rendered row and query across ${target} change`, async () => {
    const f = await fixture(); f.answer(f.calls[0]); await f.runtime.settle()
    assert.equal(f.picker().props.address.subjectId, 'alice')
    const start = f.runtime.frames.length
    if (target === 'session') f.switchSession(secondKey)
    else if (target === 'connection') f.switchConnection()
    else if (target === 'preference') f.switchPreference()
    else f.switchOwner(target)
    for (const frame of f.runtime.frames.slice(start)) assert.equal(nodes(frame).some(node => node.type === 'picker'), false, 'no stale interactive frame before effects')
    assert.equal(f.picker(), undefined)
    if (target === 'host' || target === 'missing') assert.equal(f.calls.length, 1)
    else {
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].path, '/sessions?limit=50&offset=0')
      f.answer(f.calls[1]); await f.runtime.settle()
      assert.equal(f.picker().props.ownerId, ['bob', 'preference'].includes(target) ? 'bob' : 'alice')
      assert.equal(f.picker().props.address.subjectId, ['bob', 'preference'].includes(target) ? 'bob' : 'alice')
      assert.equal(f.picker().props.sessionKey, target === 'session' ? secondKey : key)
      f.picker().props.send(); assert.equal(f.sent[0].connectionScope, target === 'connection' ? 'connection-b' : 'connection-a')
    }
    f.runtime.unmount()
  })

for (const outcome of ['success', 'failure'])
  test(`late ${outcome} cannot replace another personal owner's row or error`, async () => {
    const f = await fixture(), old = f.calls[0]
    f.switchOwner('bob'); assert.equal(f.calls.length, 2)
    f.answer(f.calls[1]); await f.runtime.settle()
    if (outcome === 'success') f.answer(old, 'alice')
    else old.reject(new Error('old alice error'))
    await f.runtime.settle()
    assert.equal(f.picker().props.ownerId, 'bob'); assert.equal(f.picker().props.address.subjectId, 'bob')
    assert.equal(nodes(f.runtime.value).some(node => node.type === 'error'), false)
    f.runtime.unmount()
  })

for (const target of ['bob', 'session', 'connection'])
  test(`a captured real model-save callback cannot send the old address after ${target} change`, async () => {
    const f = await fixture({ actualPicker: true }); f.answer(f.calls[0]); await f.runtime.settle()
    const save = nodes(f.runtime.value).find(node => node.type === 'button' && node.props.children === '保存')
    assert.equal(save.props.disabled, false)
    if (target === 'session') f.switchSession(secondKey)
    else if (target === 'connection') f.switchConnection()
    else f.switchOwner('bob')
    save.props.onClick(); await f.runtime.settle()
    assert.equal(f.transport.filter(call => call.init?.method === 'PUT').length, 0)
    assert.equal(f.transport.length, 1, 'new scope has no address until its own directory read resolves')
    f.answer(f.calls[1]); await f.runtime.settle()
    assert.equal(f.transport.length, 2)
    const query = new URL(f.transport[1].url, 'https://fixture')
    assert.equal(JSON.parse(query.searchParams.get('address')).subjectId, target === 'bob' ? 'bob' : 'alice')
    assert.equal(query.searchParams.get('owner'), target === 'bob' ? 'bob' : 'alice')
    f.runtime.unmount()
  })

test('a personal lookup retains 50-row pagination and drops an old lookup error on scope change', async () => {
  const f = await fixture()
  f.calls[0].resolve({ rows: [{ sessionKey: secondKey, address: address('alice'), updatedAt: 1 }], hasMore: true })
  await f.runtime.settle(); assert.equal(f.calls[1].path, '/sessions?limit=50&offset=1')
  f.calls[1].reject(new Error('lookup failed')); await f.runtime.settle()
  assert.equal(nodes(f.runtime.value).find(node => node.type === 'error').props.error, 'lookup failed')
  const start = f.runtime.frames.length; f.switchOwner('bob')
  for (const frame of f.runtime.frames.slice(start)) assert.equal(nodes(frame).some(node => node.type === 'error'), false)
  assert.equal(f.calls[2].path, '/sessions?limit=50&offset=0')
  f.runtime.unmount()
})

test('new owner view arriving after its session row never reuses the previous owner address', async () => {
  const f = await fixture(); f.answer(f.calls[0]); await f.runtime.settle()
  f.holdView(); f.switchOwner('bob'); f.answer(f.calls[1]); await f.runtime.settle()
  assert.equal(f.picker(), undefined)
  f.showView(); assert.equal(f.picker().props.ownerId, 'bob')
  assert.equal(f.picker().props.address.subjectId, 'bob')
  f.runtime.unmount()
})
