import test from 'node:test'
import assert from 'node:assert/strict'
import { isPersonalSessionKey, readPersonalModelsView, readPersonalSessionRows, readPersonalSessionView,
  personalSessionQuery, personalModelFailure, personalModelRequiresApiKey, personalModelEntry } from '../console-ui/src/pages/personal-models-model.mjs'
import { isLikelySessionKey, parseImSessionKey } from '../console-ui/src/utils/agent-session.ts'

const key = `personal-session:v1:${'a'.repeat(64)}`
const owner = { rootId: '/host', platform: 'qq', endpoint: 'account', adapterId: 'root\0adapter\0qq', subjectId: 'user' }
const address = { rootId: owner.rootId, platform: owner.platform, endpoint: owner.endpoint, subjectId: owner.subjectId,
  conversation: { endpoint: { adapter: 'feature', id: owner.adapterId }, kind: 'channel', id: 'room', parent: { kind: 'group', id: 'guild' }, threadId: 'topic' } }

test('recognizes only complete personal hashes without pretending they are legacy IM identities', () => {
  assert.equal(isLikelySessionKey(key), true)
  assert.equal(parseImSessionKey(key), null)
  for (const value of ['personal-session:v1:fake', `personal-session:v2:${'a'.repeat(64)}`, `im:${key}`, 'qq:account:group:room']) assert.equal(isPersonalSessionKey(value), false)
})
test('keeps every canonical personal address dimension from the owner-scoped Host directory', () => {
  const body = { success: true, data: { rows: [{ sessionKey: key, address, updatedAt: 1 }], hasMore: true } }
  assert.deepEqual(readPersonalSessionRows(body, owner), body.data)
  for (const property of ['rootId', 'platform', 'endpoint', 'subjectId']) {
    assert.throws(() => readPersonalSessionRows({ ...body, data: { ...body.data, rows: [{ ...body.data.rows[0], address: { ...address, [property]: 'foreign' } }] } }, owner))
  }
  const partial = { ...address, conversation: { ...address.conversation, parent: { kind: 'group' } } }
  assert.throws(() => readPersonalSessionRows({ success: true, data: { rows: [{ sessionKey: key, address: partial, updatedAt: 1 }], hasMore: false } }, owner))
  const query = new URL(personalSessionQuery(owner, 50), 'https://host.example')
  assert.deepEqual(JSON.parse(query.searchParams.get('owner')), owner)
  assert.equal(query.searchParams.get('limit'), '50')
  assert.equal(query.searchParams.get('offset'), '50')
})
test('requires the selection GET identity to match the selected hash and complete address', () => {
  const view = { success: true, data: { state: { identity: { key, address }, revision: 3, selection: { kind: 'preset', presetId: 'explicit-missing-reference' } }, presets: { personal: [], deployment: [] } } }
  assert.equal(readPersonalSessionView(view, key, address).state.selection.presetId, 'explicit-missing-reference')
  assert.throws(() => readPersonalSessionView(view, `personal-session:v1:${'b'.repeat(64)}`, address))
  assert.throws(() => readPersonalSessionView(view, key, { ...address, conversation: { ...address.conversation, threadId: 'another-topic' } }))
  assert.throws(() => readPersonalSessionView(view, 'qq:account:group:room', address))
})
test('projects model metadata without retaining unexpected API keys or secret references', () => {
  const raw = { success: true, data: { owners: [{ owner, ownerId: 'owner-id', revision: 1,
    connections: [{ id: 'c', revision: 1, sdk: 'openai', baseUrl: 'https://provider.example', hasKey: true, secretRef: 'hidden-ref', apiKey: 'synthetic-secret' }],
    models: [{ id: 'm', connectionId: 'c', model: 'model', capabilities: {}, apiKey: 'synthetic-secret' }], presets: [{ id: 'p', modelId: 'm' }] }],
    deployment: [{ id: 'host-p', modelId: 'host-m', model: 'host-model', sdk: 'ollama', capabilities: {}, secretRef: 'hidden-ref' }] } }
  const view = readPersonalModelsView(raw)
  assert.equal(view.owners[0].connections[0].hasKey, true)
  assert.equal(JSON.stringify(view).includes('hidden-ref'), false)
  assert.equal(JSON.stringify(view).includes('synthetic-secret'), false)
  assert.equal(raw.data.owners[0].connections[0].apiKey, 'synthetic-secret')
})
test('keeps unknown explicit presets and revision conflicts distinct from persistence unavailability', () => {
  assert.notEqual(personalModelFailure(409), personalModelFailure(503))
  assert.notEqual(personalModelFailure(404, 'unknown-preset'), personalModelFailure(503))
})


test('credential requirements follow the existing SDK contract without forcing a key for Ollama', () => {
  assert.equal(personalModelRequiresApiKey('ollama'), false)
  for (const sdk of ['openai', 'anthropic', 'google', 'deepseek', 'minimax', 'openai-compatible']) {
    assert.equal(personalModelRequiresApiKey(sdk), true)
    assert.equal(personalModelRequiresApiKey(sdk, true), false)
  }
})

test('credential-free Ollama DTOs omit empty keys and never invent a credential', () => {
  const draft = { sdk: 'ollama', baseUrl: 'https://public-ollama.example', model: 'llama3', capabilities: {} }
  for (const apiKey of [undefined, '', '   ']) {
    const entry = personalModelEntry({ ...draft, apiKey })
    assert.deepEqual(entry, draft)
    assert.equal(Object.hasOwn(entry, 'apiKey'), false)
  }
  assert.deepEqual(personalModelEntry({ ...draft, apiKey: 'literal-synthetic-key' }), { ...draft, apiKey: 'literal-synthetic-key' })
  const editing = personalModelEntry({ ...draft, sdk: 'openai', presetId: 'owned-preset', apiKey: '' })
  assert.equal(editing.presetId, 'owned-preset')
  assert.equal(Object.hasOwn(editing, 'apiKey'), false)
})
