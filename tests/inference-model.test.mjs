import test from 'node:test'
import assert from 'node:assert/strict'
import {
  objectFields,
  declaredDefaults,
  matchingSchemaBranches,
  initialSchemaValue,
} from '../console-ui/src/components/PluginConfigForm/schema-model.mjs'
import {
  applyInferenceChange,
  inferenceRequest,
  inferenceError,
  inferencePath,
  InferenceRequestError,
  purposePlan,
  schemaField,
  selectableLanguageProfiles,
} from '../console-ui/src/pages/inference/model.mjs'

test('performs one exact saved mutation request and preserves unknown outcomes without a retry', async () => {
  for (const response of [
    undefined,
    { status: 'commit-unknown' },
    { status: 'committed' },
    { status: 'conflict' },
    { status: 'not-committed' },
  ]) {
    const calls = [],
      fetch = async (url, init) => {
        calls.push({ url, init })
        if (response === undefined)
          throw new Error('private synthetic credential-bearing transport cause')
        return Response.json({ success: true, data: response })
      }
    const input = {
      ownerId: 'personal:a/b',
      mutationId: 'same-id',
      prepared: { ciphertext: 'synthetic-encrypted' },
    }
    if (response === undefined)
      await assert.rejects(
        applyInferenceChange(fetch, input),
        (error) => error.code === 'outcome-unknown' && !error.message.includes('private')
      )
    else assert.deepEqual(await applyInferenceChange(fetch, input), response)
    assert.equal(calls.length, 1)
    assert.equal(new URL(calls[0].url, 'https://host').searchParams.get('owner'), input.ownerId)
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      prepared: input.prepared,
      mutationId: 'same-id',
    })
  }
  await assert.rejects(
    applyInferenceChange(
      async () => Response.json({ success: true, data: { status: 'invalid' } }),
      { ownerId: 'host', mutationId: 'same-id', prepared: {} }
    ),
    { code: 'outcome-unknown' }
  )
})
test('keeps metadata reads read-only, owner encoded, and backend errors free of raw provider details', async () => {
  let call
  const data = await inferenceRequest(
    async (url, init) => {
      call = { url, init }
      return Response.json({ success: true, data: { revision: 1 } })
    },
    { ownerId: 'a?&b', path: '/mutation?mutationId=original' }
  )
  assert.deepEqual(data, { revision: 1 })
  assert.equal(call.init.method, 'GET')
  assert.equal(Object.hasOwn(call.init, 'body'), false)
  const url = new URL(call.url, 'https://host')
  assert.equal(url.searchParams.get('owner'), 'a?&b')
  assert.equal(url.searchParams.get('mutationId'), 'original')
  await assert.rejects(
    inferenceRequest(
      async () =>
        Response.json(
          { success: false, code: 'forbidden', error: 'private provider response' },
          { status: 403 }
        ),
      {}
    ),
    (error) => error.code === 'forbidden' && !error.message.includes('private')
  )
  assert.notEqual(
    inferenceError(new InferenceRequestError('storage-integrity')),
    inferenceError(new InferenceRequestError('invalid-input'))
  )
  assert.equal(inferencePath('', 'host'), ' /api/agent/inference?owner=host'.trim())
})
test('maps only Driver display metadata; preserves explicit values and does not invent capabilities or validation defaults', () => {
  const source = {
    type: 'object',
    required: ['baseUrl'],
    properties: {
      baseUrl: { type: 'string', format: 'uri' },
      retries: { type: 'integer', minimum: 0, default: 2 },
      mode: { enum: ['one', 'two'], type: 'string' },
      flags: { type: 'array', items: { type: 'boolean' } },
    },
  }
  const field = schemaField(source)
  const fields = objectFields(field)
  assert.equal(fields.baseUrl.required, true)
  assert.equal(fields.retries.integer, true)
  assert.equal(fields.retries.default, 2)
  assert.equal(Object.hasOwn(fields.baseUrl, 'default'), false)
  assert.equal(fields.flags.inner.type, 'boolean')
  assert.deepEqual(fields.mode.enum, ['one', 'two'])
  assert.deepEqual(source.properties.retries, { type: 'integer', minimum: 0, default: 2 })
})
test('purpose edits preserve every existing purpose and clear only explicit removed references without creating fallback models', () => {
  const original = {
    defaults: {
      chat: 'a',
      summary: 'b',
      ambient: 'c',
      image: 'i',
      perception: { profile: 'v', fallbacks: ['v2'] },
    },
    decisions: { approval: { mode: 'shadow', profile: 'd', timeoutMs: 50 } },
    agents: { planner: 'p' },
    adapters: { qq: { chat: 'q', perception: { profile: 'v' } } },
    endpoints: { 'full-key': { chat: 'e' } },
    scenes: { 'scene-key': { chat: 's' } },
  }
  const same = purposePlan(structuredClone(original), original)
  assert.deepEqual(same.perception, { profile: 'v', fallbacks: ['v2'] })
  assert.deepEqual(same.ambient, { profile: 'c' })
  assert.deepEqual(same.decisions, original.decisions)
  assert.deepEqual(same.scenes, { 'scene-key': { chat: { profile: 's' } } })
  assert.equal(Object.hasOwn(same.scenes['scene-key'], 'perception'), false)
  const next = structuredClone(original)
  delete next.defaults.summary
  delete next.agents.planner
  delete next.scenes['scene-key']
  const changed = purposePlan(next, original)
  assert.equal(changed.summary, null)
  assert.equal(changed.agents.planner, null)
  assert.equal(changed.scenes['scene-key'], null)
  assert.equal(original.defaults.summary, 'b')
  assert.deepEqual(purposePlan({ defaults: {} }).decisions, {})
})
test('Session choices are durable account incarnation references and include consumable Host models without exposing Host credentials', () => {
  const view = {
    rootId: '/host',
    accounts: { a: { incarnation: 'first', serviceId: 's' } },
    services: { s: { models: { m: { kinds: ['language'] }, i: { kinds: ['image'] } } } },
    profiles: {
      p: { id: 'p', accountId: 'a', model: 'm' },
      image: { id: 'image', accountId: 'a', model: 'i' },
    },
    deployment: [
      {
        id: 'host-profile',
        label: 'Host',
        model: 'native',
        accountId: 'ha',
        accountIncarnation: 'host-incarnation',
        definition: { kinds: ['language'] },
      },
    ],
  }
  const choices = selectableLanguageProfiles(view)
  assert.equal(choices.length, 2)
  assert.deepEqual(choices[0].selection, {
    id: 'p',
    rootId: '/host',
    accountId: 'a',
    accountIncarnation: 'first',
    kind: 'language',
  })
  assert.equal(Object.hasOwn(choices[0].selection, 'revision'), false)
  assert.equal(choices[1].selection.accountIncarnation, 'host-incarnation')
})

test('receipt recovery survives refresh and isolates same-name owners on different Hosts without storing credentials or payloads', async () => {
  const { pendingMutationKey, readPendingMutation, storePendingMutation } = await import(
    '../console-ui/src/pages/inference/model.mjs'
  )
  const items = new Map(),
    storage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value),
      removeItem: (key) => items.delete(key),
    }
  storePendingMutation(storage, {
    base: 'https://user:private-password@host-a.test/base/?token=private-query#private-fragment',
    ownerId: 'same-owner',
    mutationId: 'original-mutation',
  })
  assert.equal(
    readPendingMutation(storage, 'https://host-a.test/base', 'same-owner'),
    'original-mutation'
  )
  assert.equal(readPendingMutation(storage, 'https://host-b.test/base', 'same-owner'), null)
  assert.equal(readPendingMutation(storage, 'https://host-a.test/base', 'different-owner'), null)
  storePendingMutation(storage, {
    base: 'https://host-b.test/base',
    ownerId: 'same-owner',
    mutationId: 'other-mutation',
  })
  storePendingMutation(storage, {
    base: 'https://host-b.test/base',
    ownerId: 'same-owner',
    mutationId: null,
  })
  assert.equal(
    readPendingMutation(storage, 'https://host-a.test/base', 'same-owner'),
    'original-mutation'
  )
  assert.equal([...items.entries()].flat().join('').includes('private'), false)
  assert.equal(
    pendingMutationKey('https://host-a.test/base/', 'same-owner'),
    pendingMutationKey('https://host-a.test/base', 'same-owner')
  )
})

test('clears only explicit precommit rejection, never infers outcome from an HTTP status', async () => {
  for (const status of [400, 403, 409, 503]) {
    const input = { ownerId: 'host', mutationId: 'one-id', prepared: {} }
    const rejected = await applyInferenceChange(
      async () =>
        Response.json(
          {
            success: false,
            code: 'driver-contract-mismatch',
            mutationOutcome: 'not-committed',
          },
          { status }
        ),
      input
    )
    assert.deepEqual(rejected, { status: 'not-committed', code: 'driver-contract-mismatch' })
    await assert.rejects(
      applyInferenceChange(
        async () => Response.json({ success: false, code: 'forbidden' }, { status }),
        input
      ),
      { code: 'outcome-unknown' }
    )
  }
})

test('uses explicit pre-handler rejection only for the fresh request, independent of status codes', async () => {
  for (const status of [401, 403, 503]) {
    assert.deepEqual(
      await applyInferenceChange(
        async () =>
          Response.json(
            { success: false, code: 'unauthorized', requestOutcome: 'not-dispatched' },
            { status }
          ),
        { ownerId: 'host', mutationId: 'fresh', prepared: {} }
      ),
      { status: 'not-committed', code: 'unauthorized' }
    )
  }
})

test('uses the actual shared editor contract for nested objects, arrays, enum, nullable fields and defaults', () => {
  const projected = schemaField({
    type: 'object',
    required: ['records'],
    properties: {
      records: {
        type: 'array',
        items: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } },
      },
      nullable: { type: ['number', 'null'], default: null },
      nested: {
        type: 'object',
        properties: { enabled: { type: 'boolean', default: false } },
        default: {},
      },
    },
  })
  const fields = objectFields(projected)
  assert.equal(fields.records.required, true)
  assert.deepEqual(objectFields(fields.records.inner).mode.enum, ['a', 'b'])
  assert.deepEqual(matchingSchemaBranches(fields.nullable.list, null), [1])
  assert.deepEqual(declaredDefaults(projected, { records: [], nullable: 3 }), {
    records: [],
    nullable: 3,
    nested: { enabled: false },
  })
  assert.deepEqual(initialSchemaValue(fields.nullable), null)
  assert.equal(Object.hasOwn(projected, 'properties'), false)
})

test('preserves authentication error meaning without exposing provider details or prescribing blind retries', () => {
  for (const code of [
    'not-authorized',
    'reauthorize',
    'disconnected',
    'target-denied',
    'rejected',
    'not-submitted',
    'operation-closed',
  ]) {
    const message = inferenceError(new InferenceRequestError(code))
    assert.equal(message.includes('稍后重新读取'), false)
    assert.equal(message.includes('private'), false)
  }
  assert.match(inferenceError(new InferenceRequestError('not-authorized')), /登录信息不匹配/)
  assert.match(inferenceError(new InferenceRequestError('outcome-unknown')), /查询结果/)
})
