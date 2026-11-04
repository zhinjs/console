import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as model from '../console-ui/src/pages/inference/model.mjs'

const source = await readFile(
  new URL('../console-ui/src/pages/inference/useInferenceManagement.ts', import.meta.url),
  'utf8'
)
function hooks() {
  const slots = []
  let cursor = 0,
    dirty = false,
    effects = [],
    renderFn,
    value
  const equal = (a, b) =>
    a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const api = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [
        slots[i],
        (next) => {
          const result = typeof next === 'function' ? next(slots[i]) : next
          if (!Object.is(result, slots[i])) {
            slots[i] = result
            dirty = true
          }
        },
      ]
    },
    useRef(initial) {
      const i = cursor++
      return slots[i] ?? (slots[i] = { current: initial })
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!equal(slots[i]?.deps, deps)) {
        const previous = slots[i]
        slots[i] = { deps, cleanup: previous?.cleanup }
        effects.push(() => {
          previous?.cleanup?.()
          slots[i].cleanup = fn()
        })
      }
    },
  }
  function render() {
    let count = 0
    do {
      assert.ok(++count < 40)
      dirty = false
      cursor = 0
      value = renderFn()
      const pending = effects
      effects = []
      pending.forEach((fn) => fn())
    } while (dirty)
    return value
  }
  return {
    api,
    mount(fn) {
      renderFn = fn
      return render()
    },
    render,
    async settle() {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve()
        if (dirty || effects.length) render()
      }
      return value
    },
    unmount() {
      for (const item of slots) item?.cleanup?.()
    },
    get value() {
      return value
    },
  }
}
function fixture(storage = new Map(), { preferredOwnerId } = {}) {
  const runtime = hooks(),
    calls = []
  let connection = { scope: 'scope-a', base: 'https://host-a.test/base' }
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
  const fetch = (url, init) =>
    new Promise((resolve, reject) =>
      calls.push({ url, init, base: connection.base, resolve, reject, answered: false })
    )
  const mocks = {
    react: runtime.api,
    '../../utils/auth': { apiFetch: fetch, getApiBase: () => connection.base },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: (scope) => scope === connection.scope },
    './model.mjs': model,
  }
  const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    module = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`)
      return mocks[name]
    },
    module,
    module.exports
  )
  runtime.mount(() => module.exports.useInferenceManagement(connection.scope, preferredOwnerId))
  function answer(path, data, status = 200, base = connection.base) {
    const call = calls.find(
      (call) =>
        !call.answered &&
        call.base === base &&
        new URL(call.url, 'https://fixture').pathname.endsWith(path)
    )
    assert.ok(call, `missing ${path} @ ${base}`)
    call.answered = true
    call.resolve(
      Response.json(
        status === 200
          ? { success: true, data }
          : typeof data === 'object'
          ? data
          : { success: false, code: data },
        {
          status,
        }
      )
    )
    return call
  }
  return {
    runtime,
    calls,
    storage,
    answer,
    switchHost() {
      connection = { scope: 'scope-b', base: 'https://host-b.test/base' }
      runtime.render()
    },
    get connection() {
      return connection
    },
  }
}
const owner = (id = 'owner') => ({ id, label: id, kind: 'host' })
const view = (id = 'owner', label = 'a') => ({
  rootId: `/${label}`,
  ownerId: id,
  revision: 1,
  hostAdministrator: true,
  services: {},
  accounts: {},
  profiles: {},
  statuses: {},
  deployment: [],
  drivers: [],
  purposes: { defaults: {} },
})
async function ready(f, owners = [owner()], id = owners[0].id, label = 'a') {
  f.answer('/owners', owners)
  await f.runtime.settle()
  f.answer('/inference', view(id, label))
  await f.runtime.settle()
}

test('initial owner preference selects the first view atomically and never overrides later manual selection', async () => {
  const f = fixture(new Map(), { preferredOwnerId: 'two' })
  f.answer('/owners', [owner('one'), owner('two')])
  await f.runtime.settle()
  assert.equal(f.runtime.value.ownerId, 'two')
  assert.equal(f.runtime.value.busy, true)
  assert.equal(f.calls.filter((call) => call.url.includes('owner=one')).length, 0)
  f.answer('/inference', view('two'))
  await f.runtime.settle()
  assert.equal(f.runtime.value.view.ownerId, 'two')
  f.runtime.value.setOwnerId('one')
  await f.runtime.settle()
  await ready(f, [owner('one'), owner('two')], 'one')
  const refreshing = f.runtime.value.load()
  await f.runtime.settle()
  await ready(f, [owner('one'), owner('two')], 'one')
  await refreshing
  assert.equal(f.runtime.value.ownerId, 'one')
  assert.equal(f.runtime.value.view.ownerId, 'one')
  f.runtime.unmount()
})

async function component(runtime, path, mocks) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  const dependencies = {
    react: runtime.api,
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    ...mocks,
  }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      assert.ok(name in dependencies, `unexpected component dependency ${name}`)
      return dependencies[name]
    },
    module,
    module.exports
  )
  return module.exports
}
function nodes(node) {
  return node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]
    : []
}
const personalOwner = {
  rootId: '/host',
  platform: 'qq',
  endpoint: 'bot',
  adapterId: 'adapter',
  subjectId: 'user',
}
const personalAddress = {
  rootId: '/host',
  platform: 'qq',
  endpoint: 'bot',
  subjectId: 'user',
  conversation: { endpoint: { adapter: 'qq', id: 'adapter' }, kind: 'private', id: 'user' },
}
const personalKey = `personal-session:v1:${'a'.repeat(64)}`

for (const lateResult of ['success', 'failure'])
  test(`a directory refresh owns its loading state after a late ${lateResult} from the previous epoch`, async () => {
    const runtime = hooks(),
      calls = [],
      errors = []
    let epoch = 1
    const management = (id) => ({
      ownerId: 'personal',
      owners: [{ id: 'personal', personal: personalOwner }],
      view: {},
      revisionEpoch: id,
      active: () => id === epoch,
      setError: (error) => errors.push(error),
      request: () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
    })
    let m = management(epoch)
    const personal = await import('../console-ui/src/pages/personal-session-model.mjs')
    const { PersonalSessions } = await component(
      runtime,
      '../console-ui/src/pages/inference/PersonalSessions.tsx',
      {
        'react-router-dom': { Link: 'link' },
        '../../components/ui/button': { Button: 'button' },
        '../../utils/agent-session': { agentSessionsPath: () => '/session' },
        '../PersonalSessionModelPicker': { PersonalSessionModelPicker: 'picker' },
        '../personal-session-model.mjs': personal,
        './model.mjs': model,
      }
    )
    runtime.mount(() => PersonalSessions({ management: m, connectionScope: 'connection' }))
    await runtime.settle()
    assert.equal(calls.length, 1)
    epoch++
    m = management(epoch)
    runtime.render()
    await runtime.settle()
    assert.equal(calls.length, 2)
    if (lateResult === 'success')
      calls[0].resolve({
        rows: [{ sessionKey: personalKey, address: personalAddress, updatedAt: 1 }],
        hasMore: true,
      })
    else calls[0].reject(new Error('stale-operation'))
    await runtime.settle()
    assert.equal(
      nodes(runtime.value).some((node) => node.type === 'link'),
      false
    )
    assert.equal(JSON.stringify(runtime.value).includes('暂无已保存'), false)
    calls[1].resolve({ rows: [], hasMore: false })
    await runtime.settle()
    assert.equal(JSON.stringify(runtime.value).includes('暂无已保存'), true)
    epoch++
    m = management(epoch)
    runtime.render()
    await runtime.settle()
    calls[2].resolve({
      rows: [{ sessionKey: personalKey, address: personalAddress, updatedAt: 2 }],
      hasMore: true,
    })
    await runtime.settle()
    assert.equal(
      nodes(runtime.value).find((node) => node.props?.children === '加载更多').props.disabled,
      false
    )
    assert.deepEqual(errors, [])
    runtime.unmount()
  })

test('confirming a rebound Profile saves its complete new account identity; native model edits remain unchanged', async () => {
  const runtime = hooks(),
    calls = []
  const previous = {
    id: 'profile',
    rootId: '/host',
    accountId: 'old',
    accountIncarnation: 'old-incarnation',
    kind: 'language',
  }
  const current = { ...previous, accountId: 'new', accountIncarnation: 'new-incarnation' }
  let models = {
    rootId: '/host',
    accounts: { new: { incarnation: 'new-incarnation', serviceId: 'service' } },
    services: { service: { models: { native: { kinds: ['language'] } } } },
    profiles: { profile: { id: 'profile', model: 'native', accountId: 'new' } },
    deployment: [],
  }
  const personal = await import('../console-ui/src/pages/personal-session-model.mjs')
  const state = (profile) => ({
    identity: { key: personalKey, address: personalAddress },
    revision: 1,
    selection: { kind: 'profile', profile },
  })
  const { PersonalSessionModelPicker } = await component(
    runtime,
    '../console-ui/src/pages/PersonalSessionModelPicker.tsx',
    {
      'lucide-react': { RefreshCw: 'icon' },
      '../components/ui/button': { Button: 'button' },
      '../components/ui/select': { SelectField: 'select' },
      '../components/error-alert': { ErrorAlert: 'error' },
      '../utils/auth': {
        apiFetch: async (url, init) => {
          calls.push({ url, init })
          return Response.json({
            success: true,
            data: state(init?.method === 'PUT' ? current : previous),
          })
        },
      },
      '../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
      './inference/model.mjs': model,
      './personal-session-model.mjs': personal,
    }
  )
  runtime.mount(() =>
    PersonalSessionModelPicker({
      sessionKey: personalKey,
      address: personalAddress,
      models,
      ownerId: 'owner',
      connectionScope: 'scope',
    })
  )
  await runtime.settle()
  let save = nodes(runtime.value).find(
    (node) => node.type === 'button' && node.props.children === '保存'
  )
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await runtime.settle()
  assert.deepEqual(
    JSON.parse(calls.find((call) => call.init?.method === 'PUT').init.body).selection,
    { kind: 'profile', profile: current }
  )
  save = nodes(runtime.value).find(
    (node) => node.type === 'button' && node.props.children === '保存'
  )
  assert.equal(save.props.disabled, true)
  models = {
    ...models,
    profiles: { profile: { ...models.profiles.profile, model: 'another', revision: 2 } },
    services: { service: { models: { another: { kinds: ['language'] } } } },
  }
  runtime.render()
  assert.equal(
    nodes(runtime.value).find((node) => node.type === 'button' && node.props.children === '保存')
      .props.disabled,
    true
  )
  runtime.unmount()
})

test('connection replacement clears every old owner/view and rejects late read/action/export callbacks', async () => {
  const f = fixture()
  await ready(f)
  const old = f.runtime.value,
    exporting = old.request('/export').catch((error) => error)
  f.switchHost()
  assert.equal(f.runtime.value.view, null)
  assert.deepEqual(f.runtime.value.owners, [])
  assert.equal(old.active(), false)
  f.answer('/export', { private: 'old-host' }, 200, 'https://host-a.test/base')
  await f.runtime.settle()
  assert.equal((await exporting).code, 'stale-operation')
  old.setError('stale error must not publish')
  await ready(f, [owner('new-owner')], 'new-owner', 'b')
  assert.equal(f.runtime.value.ownerId, 'new-owner')
  assert.equal(f.runtime.value.view.rootId, '/b')
  assert.equal(f.runtime.value.error, '')
  assert.equal(
    f.calls.filter(
      (call) => call.base === 'https://host-b.test/base' && call.url.includes('owner=owner')
    ).length,
    0
  )
  f.runtime.unmount()
})

test('owner switching invalidates previous handlers, keeps pending receipts scoped and refuses unauthorized recovery', async () => {
  const f = fixture()
  await ready(f, [owner('one'), owner('two')], 'one')
  const old = f.runtime.value,
    request = old.request('/export').catch((error) => error)
  old.setOwnerId('two')
  await f.runtime.settle()
  assert.equal(f.runtime.value.view, null)
  assert.equal(old.active(), false)
  f.answer('/export', { private: 'old-owner' })
  await f.runtime.settle()
  assert.equal((await request).code, 'stale-operation')
  old.setError('stale owner error')
  await ready(f, [owner('one'), owner('two')], 'two')
  assert.equal(f.runtime.value.error, '')
  assert.equal(f.runtime.value.ownerId, 'two')
  const loading = f.runtime.value.load()
  await f.runtime.settle()
  f.answer('/owners', 'forbidden', 403)
  await loading
  await f.runtime.settle()
  assert.equal(f.runtime.value.view, null)
  assert.deepEqual(f.runtime.value.owners, [])
  f.runtime.unmount()
})

test('unknown apply persists only its ID, survives refresh, and recovery only queries the original receipt', async () => {
  const f = fixture()
  await ready(f)
  const saving = f.runtime.value.save('/key/prepare', {
    accountId: 'account',
    expectedRevision: 0,
    key: 'synthetic-plaintext-key',
  })
  await f.runtime.settle()
  f.answer('/key/prepare', {
    prepared: { ciphertext: 'synthetic-private-capsule' },
    fingerprint: 'fingerprint',
    baseRevision: 1,
  })
  await f.runtime.settle()
  const applied = f.answer('/apply', { status: 'commit-unknown' }),
    mutationId = JSON.parse(applied.init.body).mutationId
  assert.equal(await saving, false)
  await f.runtime.settle()
  assert.equal(f.runtime.value.pending, mutationId)
  assert.deepEqual([...f.storage.values()], [mutationId])
  assert.equal([...f.storage].flat().join('').includes('synthetic-'), false)
  assert.equal(await f.runtime.value.savePlan({ version: 1 }), false)
  assert.equal(f.calls.filter((call) => call.url.endsWith('/apply?owner=owner')).length, 1)
  f.runtime.unmount()
  const refreshed = fixture(f.storage)
  await ready(refreshed)
  assert.equal(refreshed.runtime.value.pending, mutationId)
  const query = refreshed.runtime.value.queryPending()
  await refreshed.runtime.settle()
  const receipt = refreshed.answer('/mutation', {
    mutationId,
    graphRevision: 2,
    result: { ownerId: 'owner' },
  })
  assert.equal(new URL(receipt.url, 'https://fixture').searchParams.get('mutationId'), mutationId)
  await refreshed.runtime.settle()
  await ready(refreshed)
  await query
  await refreshed.runtime.settle()
  assert.equal(refreshed.runtime.value.pending, null)
  assert.equal(
    refreshed.calls.some((call) => call.url.includes('/apply')),
    false
  )
  refreshed.runtime.unmount()
})

test('browser receipt-storage failure prevents a new untrackable apply without blocking configuration reads', async () => {
  const f = fixture()
  await ready(f)
  globalThis.sessionStorage.setItem = () => {
    throw new Error('synthetic browser storage unavailable')
  }
  const saving = f.runtime.value.savePlan({ version: 1 })
  await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'synthetic' }, fingerprint: 'f', baseRevision: 1 })
  assert.equal(await saving, false)
  await f.runtime.settle()
  assert.equal(
    f.calls.some((call) => call.url.includes('/apply')),
    false
  )
  assert.match(f.runtime.value.error, /尚未提交/)
  assert.equal(f.runtime.value.view.rootId, '/a')
  f.runtime.unmount()
})

test('proved HTTP precommit rejection clears the pending receipt and leaves saving available', async () => {
  const f = fixture()
  await ready(f)
  const saving = f.runtime.value.savePlan({ version: 1 })
  await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'synthetic' }, fingerprint: 'f', baseRevision: 1 })
  await f.runtime.settle()
  f.answer('/apply', { success: false, code: 'forbidden', mutationOutcome: 'not-committed' }, 403)
  assert.equal(await saving, false)
  await f.runtime.settle()
  assert.equal(f.runtime.value.pending, null)
  assert.equal(f.storage.size, 0)
  assert.match(f.runtime.value.error, /无权/)
  const next = f.runtime.value.savePlan({ version: 1 })
  await f.runtime.settle()
  f.answer('/plan', 'invalid-input', 400)
  assert.equal(await next, false)
  assert.equal(f.calls.filter((call) => call.url.includes('/apply')).length, 1)
  f.runtime.unmount()
})

test('an authenticated fresh save rejected before dispatch clears only that fresh pending ID', async () => {
  const f = fixture()
  await ready(f)
  const saving = f.runtime.value.savePlan({ version: 1 })
  await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'synthetic' }, fingerprint: 'f', baseRevision: 1 })
  await f.runtime.settle()
  f.answer(
    '/apply',
    { success: false, code: 'unauthorized', requestOutcome: 'not-dispatched' },
    401
  )
  assert.equal(await saving, false)
  await f.runtime.settle()
  assert.equal(f.runtime.value.pending, null)
  assert.equal(f.storage.size, 0)
  assert.equal(f.calls.filter((call) => call.url.includes('/apply')).length, 1)
  assert.equal(
    f.calls.some((call) => call.url.includes('/mutation')),
    false
  )
  f.runtime.unmount()
})

test('the single graph editor preserves sibling decision modes and model IDs across parent refreshes', async () => {
  const runtime = hooks(), plans = [], requests = []
  const original = {
    defaults: {},
    decisions: {
      skills: { mode: 'off', profile: 'decision-one', timeoutMs: 90, minConfidence: 0.6 },
      tools: { mode: 'active', profile: 'decision-two', maxSelections: 3 },
    },
  }
  const management = {
    view: {
      ...view(), purposes: original,
      profiles: {
        'decision-one': { id: 'decision-one', accountId: 'account', model: 'decision' },
        'decision-two': { id: 'decision-two', accountId: 'account', model: 'decision' },
        'language-only': { id: 'language-only', accountId: 'account', model: 'chat' },
      },
      accounts: { account: { serviceId: 'service' } },
      services: { service: { models: { decision: { kinds: ['decision'] }, chat: { kinds: ['language'] } } } },
    },
    active: () => true, busy: false, pending: null,
    request: async path => { requests.push(path); return { adapters: [], endpoints: [], scenes: [], agents: [] } },
    savePlan: async plan => { plans.push(plan); return true },
    setError: error => assert.fail(error),
  }
  management.source = { view: management.view, connectionScope: 'scope', base: 'https://host.test' }
  const { Purposes } = await component(runtime, '../console-ui/src/pages/inference/Purposes.tsx', {
    'lucide-react': { Plus: 'icon', Trash2: 'icon' }, './model.mjs': model,
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select' }, '../../components/ui/card': { Card: 'card' },
  })
  runtime.mount(() => Purposes({ management })); await runtime.settle()
  const select = label => nodes(runtime.value).find(node => node.type === 'select' && node.props['aria-label'] === label)
  for (const label of ['技能选择', '工具选择', '记忆选择', 'Agent 选择', '工具审批建议', '旁听参与判断']) {
    assert.deepEqual(select(`${label}模式`).props.options.map(option => option.value), ['off', 'shadow', 'active'])
    assert.deepEqual(select(`${label}模型`).props.options.map(option => option.value), ['', 'decision-one', 'decision-two'])
  }
  select('技能选择模式').props.onValueChange('shadow'); runtime.render()
  select('技能选择模型').props.onValueChange('decision-two'); runtime.render()
  runtime.render(); await runtime.settle() // Parent language/status refresh does not remount the graph draft.
  assert.equal(select('技能选择模式').props.value, 'shadow')
  assert.equal(select('技能选择模型').props.value, 'decision-two')
  assert.equal(select('工具选择模式').props.value, 'active')
  assert.deepEqual(plans, []); assert.deepEqual(requests, ['/targets'])
  await runtime.value.props.onSubmit({ preventDefault() {} })
  assert.deepEqual(plans[0].purposes.decisions, {
    skills: { ...original.decisions.skills, mode: 'shadow', profile: 'decision-two' },
    tools: original.decisions.tools,
  })
  assert.deepEqual(original.decisions.skills, { mode: 'off', profile: 'decision-one', timeoutMs: 90, minConfidence: 0.6 })
  runtime.unmount()
})

test('decision purpose saves use only graph prepare/apply and reload the committed selection', async () => {
  const f = fixture(); await ready(f)
  const plan = { version: 1, purposes: { decisions: { skills: { mode: 'shadow', profile: 'decision-two' } } } }
  const saving = f.runtime.value.savePlan(plan); await f.runtime.settle()
  const prepared = { ciphertext: 'synthetic-purpose-plan' }
  const request = f.answer('/plan', { prepared, fingerprint: 'purpose-fingerprint', baseRevision: 1 })
  assert.deepEqual(JSON.parse(request.init.body).plan, plan)
  await f.runtime.settle()
  const applied = f.answer('/apply', { status: 'committed', mutationId: 'receipt', graphRevision: 2 })
  assert.deepEqual(JSON.parse(applied.init.body).prepared, prepared)
  await f.runtime.settle()
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', { ...view(), revision: 2, purposes: { defaults: {}, decisions: { skills: { mode: 'shadow', profile: 'decision-two' } } } })
  await f.runtime.settle(); assert.equal(await saving, true)
  assert.deepEqual(f.runtime.value.view.purposes.decisions.skills, { mode: 'shadow', profile: 'decision-two' })
  assert.equal(f.runtime.value.pending, null)
  assert.ok(f.calls.every(call => new URL(call.url, 'https://fixture').pathname.startsWith('/api/agent/inference')))
  assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 1)
  assert.equal(f.calls.some(call => call.url.includes('config:apply') || call.url.includes('config:patch')), false)
  f.runtime.unmount()
})

const readSource = f => f.runtime.value.source

test('a prepared plan cannot silently rebase a draft onto a newer graph revision', async () => {
  const f = fixture(); await ready(f)
  const source = readSource(f)
  const saving = f.runtime.value.savePlan({ version: 1 }, { source }); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'newer-plan' }, fingerprint: 'newer', baseRevision: 2 })
  await f.runtime.settle()
  assert.equal(f.calls.some(call => call.url.includes('/apply')), false)
  assert.equal(await saving, false)
  assert.deepEqual([...f.storage], [])
  assert.match(f.runtime.value.error, /变化|重新/)
  f.runtime.unmount()
})

test('refreshing a graph never endorses an already-open draft; reopening uses the newly read revision', async () => {
  const f = fixture(); await ready(f)
  const source = readSource(f)
  const refresh = f.runtime.value.load(); await f.runtime.settle()
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', { ...view(), revision: 2 }); await refresh; await f.runtime.settle()
  const saving = f.runtime.value.savePlan({ version: 1 }, { source }); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'fresh-plan' }, fingerprint: 'fresh', baseRevision: 2 })
  await f.runtime.settle()
  assert.equal(f.calls.some(call => call.url.includes('/apply')), false)
  assert.equal(await saving, false); assert.deepEqual([...f.storage], [])
  const reopened = f.runtime.value.savePlan({ version: 1 }, { source: readSource(f) }); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'fresh-plan' }, fingerprint: 'fresh', baseRevision: 2 }); await f.runtime.settle()
  f.answer('/apply', { status: 'committed', graphRevision: 3 }); await f.runtime.settle()
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', { ...view(), revision: 3 }); await f.runtime.settle()
  assert.equal(await reopened, true)
  assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 1)
  f.runtime.unmount()
})

for (const change of ['owner', 'connection'])
  test(`an old draft source cannot prepare a mutation after ${change} replacement`, async () => {
    const f = fixture(); await ready(f, [owner('one'), owner('two')], 'one')
    const source = readSource(f)
    if (change === 'owner') f.runtime.value.setOwnerId('two')
    else f.switchHost()
    await f.runtime.settle(); await ready(f, [owner('two')], 'two')
    const start = f.calls.length
    const saving = f.runtime.value.savePlan({ version: 1 }, { source }); await f.runtime.settle()
    assert.equal(f.calls.length, start)
    assert.equal(await saving, false)
    f.runtime.unmount()
  })

test('a concurrent commit after a matching review still uses the existing apply-conflict receipt path once', async () => {
  const f = fixture(); await ready(f)
  const saving = f.runtime.value.savePlan({ version: 1 }, { source: readSource(f) }); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'matching-plan' }, fingerprint: 'matching', baseRevision: 1 }); await f.runtime.settle()
  f.answer('/apply', { status: 'conflict', code: 'revision-conflict' }); await f.runtime.settle()
  assert.equal(await saving, false)
  assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 1)
  assert.equal(f.runtime.value.pending, null); assert.deepEqual([...f.storage], [])
  f.runtime.unmount()
})


test('an old plan uses resource bindings from its read source, never from the refreshed graph', async () => {
  const f = fixture(); await ready(f)
  const source = readSource(f)
  const refresh = f.runtime.value.load(); await f.runtime.settle()
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', { ...view(), revision: 2, profiles: { added: { id: 'added' } } }); await refresh; await f.runtime.settle()
  const saving = f.runtime.value.savePlan({ version: 1 }, { source }); await f.runtime.settle()
  const request = f.answer('/plan', { prepared: { ciphertext: 'new-graph' }, fingerprint: 'new', baseRevision: 2 })
  assert.deepEqual(JSON.parse(request.init.body).bindings, { services: {}, accounts: {}, profiles: {} })
  await f.runtime.settle(); assert.equal(await saving, false)
  assert.equal(f.calls.some(call => call.url.includes('/apply')), false)
  f.runtime.unmount()
})

test('credential review also refuses a newer graph before storing any mutation receipt or applying', async () => {
  const f = fixture(); await ready(f)
  const saving = f.runtime.value.save('/key/prepare', { accountId: 'account', expectedRevision: 0, key: 'synthetic-key' }, { source: readSource(f) }); await f.runtime.settle()
  f.answer('/key/prepare', { prepared: { ciphertext: 'prepared-credential' }, fingerprint: 'credential', baseRevision: 2 })
  await f.runtime.settle(); assert.equal(await saving, false)
  assert.equal(f.calls.some(call => call.url.includes('/apply')), false)
  assert.deepEqual([...f.storage], [])
  f.runtime.unmount()
})

const purposeView = (revision, mode = 'off') => ({
  ...view(), revision,
  purposes: { defaults: {}, decisions: {
    skills: { mode, profile: 'decision-one', timeoutMs: 90, minConfidence: 0.6 },
    tools: { mode: 'active', profile: 'decision-two', maxSelections: 3 },
  } },
  profiles: {
    'decision-one': { id: 'decision-one', accountId: 'account', model: 'decision' },
    'decision-two': { id: 'decision-two', accountId: 'account', model: 'decision' },
  },
  accounts: { account: { serviceId: 'service' } },
  services: { service: { models: { decision: { kinds: ['decision'] } } } },
})
async function purposeFixture() {
  const f = fixture(), runtime = hooks(), submissions = []
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', purposeView(1)); await f.runtime.settle()
  const { Purposes } = await component(runtime, '../console-ui/src/pages/inference/Purposes.tsx', {
    'lucide-react': { Plus: 'icon', Trash2: 'icon' }, './model.mjs': model,
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select' }, '../../components/ui/card': { Card: 'card' },
  })
  runtime.mount(() => Purposes({ management: { ...f.runtime.value, savePlan: (plan, options) => {
    submissions.push({ plan, options }); return f.runtime.value.savePlan(plan, options)
  } } }))
  f.answer('/targets', { adapters: [], endpoints: [], scenes: [], agents: [] }); await runtime.settle()
  const select = () => nodes(runtime.value).find(node => node.type === 'select' && node.props['aria-label'] === '技能选择模式')
  async function finish(revision, mode, receiptRevision = revision) {
    f.answer('/apply', { status: 'committed', receipt: { graphRevision: receiptRevision } }); await f.runtime.settle()
    f.answer('/owners', [owner()]); await f.runtime.settle()
    f.answer('/inference', purposeView(revision, mode)); await f.runtime.settle(); await runtime.settle()
  }
  return { ...f, page: runtime, submissions, finish,
    mode: () => select().props.value,
    choose(mode) { select().props.onValueChange(mode); runtime.render() },
    submit() { return runtime.value.props.onSubmit({ preventDefault() {} }) },
    refreshPage() { runtime.render() },
  }
}

test('real Purposes retains its draft and original source through external refresh and rejects a newer prepared base', async () => {
  const f = await purposeFixture(), origin = f.runtime.value.source
  f.choose('shadow')
  const refresh = f.runtime.value.load(); await f.runtime.settle()
  f.answer('/owners', [owner()]); await f.runtime.settle()
  f.answer('/inference', purposeView(2, 'active')); await refresh; await f.runtime.settle()
  f.refreshPage(); assert.equal(f.mode(), 'shadow')
  const saving = f.submit(); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'external-newer' }, fingerprint: 'newer', baseRevision: 2 }); await f.runtime.settle()
  assert.equal(await saving, undefined)
  assert.strictEqual(f.submissions[0].options.source, origin)
  assert.equal(f.calls.some(call => call.url.includes('/apply')), false)
  assert.equal(f.mode(), 'shadow'); assert.deepEqual([...f.storage], [])
  assert.deepEqual(f.submissions[0].plan.purposes.decisions.tools, { mode: 'active', profile: 'decision-two', maxSelections: 3 })
  f.page.unmount(); f.runtime.unmount()
})

for (const editDuringSave of [false, true])
  test(`real Purposes advances only after its proven save and preserves ${editDuringSave ? 'new edits during the wait' : 'a second normal save'}`, async () => {
    const f = await purposeFixture()
    f.choose('shadow')
    const saving = f.submit(); await f.runtime.settle()
    f.answer('/plan', { prepared: { ciphertext: 'own-save' }, fingerprint: 'own', baseRevision: 1 }); await f.runtime.settle()
    if (editDuringSave) f.choose('active')
    await f.finish(2, 'shadow'); await saving; await f.page.settle(); f.refreshPage()
    assert.equal(f.mode(), editDuringSave ? 'active' : 'shadow')
    if (!editDuringSave) f.choose('active')
    const again = f.submit(); await f.runtime.settle()
    assert.equal(f.submissions[1].options.source.view.revision, 2)
    assert.equal(f.submissions[1].plan.purposes.decisions.skills.mode, 'active')
    f.answer('/plan', { prepared: { ciphertext: 'own-save-again' }, fingerprint: 'again', baseRevision: 2 }); await f.runtime.settle()
    await f.finish(3, 'active'); await again; await f.page.settle()
    assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 2)
    assert.equal(f.mode(), 'active')
    f.page.unmount(); f.runtime.unmount()
  })

test('unknown Purposes save retains the source and all later edits without replaying the mutation', async () => {
  const f = await purposeFixture(), origin = f.runtime.value.source
  f.choose('shadow'); const saving = f.submit(); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'unknown-save' }, fingerprint: 'unknown', baseRevision: 1 }); await f.runtime.settle()
  f.choose('active'); f.answer('/apply', { status: 'commit-unknown' }); await f.runtime.settle(); await saving; f.refreshPage()
  assert.equal(f.mode(), 'active'); assert.ok(f.runtime.value.pending)
  await f.submit(); assert.strictEqual(f.submissions[1].options.source, origin)
  assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 1)
  assert.equal(f.calls.filter(call => call.url.includes('/plan')).length, 1)
  f.page.unmount(); f.runtime.unmount()
})

test('reading someone else’s subsequent revision after an own commit cannot move the purpose draft baseline', async () => {
  const f = await purposeFixture(), origin = f.runtime.value.source
  f.choose('shadow'); const saving = f.submit(); await f.runtime.settle()
  f.answer('/plan', { prepared: { ciphertext: 'own-then-external' }, fingerprint: 'own', baseRevision: 1 }); await f.runtime.settle()
  await f.finish(3, 'active', 2); await saving; f.refreshPage()
  assert.equal(f.mode(), 'shadow')
  const again = f.submit(); await f.runtime.settle()
  assert.strictEqual(f.submissions[1].options.source, origin)
  f.answer('/plan', { prepared: { ciphertext: 'external-current' }, fingerprint: 'external', baseRevision: 3 }); await f.runtime.settle(); await again
  assert.equal(f.calls.filter(call => call.url.includes('/apply')).length, 1)
  f.page.unmount(); f.runtime.unmount()
})
