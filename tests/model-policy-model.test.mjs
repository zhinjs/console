import test from 'node:test'
import assert from 'node:assert/strict'
import { readModelPolicyView, readModelPolicyRefs, modelPolicyFailure, selectAgentPreset, deploymentPresetChoices, policyAddressKey } from '../console-ui/src/pages/model-policy-model.mjs'
const address = { rootId: '/host', platform: 'icqq', endpoint: 'account', conversation: { endpoint: { adapter: 'adapter', id: 'canonical\0id' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' } }
const data = () => ({ revision: 1, refsOverride: { defaults: { chat: 'current' } }, baseline: { defaults: { chat: 'initial' } }, rootId: '/host', presets: [{ id: 'current', modelId: 'm', model: 'model', sdk: 'ollama' }],
  targets: { adaptersAvailable: true, adapters: [{ capabilityId: 'actual-capability', platform: 'icqq' }], endpoints: [{ capabilityId: 'actual-capability', instanceId: 'stable-id', address: { rootId: '/host', platform: 'icqq', endpoint: 'account', adapterId: 'canonical\0id' } }], scenesAvailable: true, scenes: [{ address: structuredClone(address) }], sceneHasMore: false } })

test('reads detached closed model refs and real scope metadata without retaining private execution data', () => {
  const input = data(), value = readModelPolicyView({ success: true, data: input })
  assert.deepEqual(value, input)
  input.targets.scenes[0].address.conversation.id = 'mutated'
  assert.equal(value.targets.scenes[0].address.conversation.id, 'room')
  for (const key of ['apiKey', 'secretRef', 'hostFactoryData', 'headers']) {
    const input = data(); input.presets[0][key] = 'SYNTHETIC-PRIVATE'
    assert.throws(() => readModelPolicyView({ success: true, data: input }), /invalid_response/)
  }
})

test('keeps the purpose whitelist and exact root/endpoint/parent/thread boundaries', () => {
  for (const invalid of [{ defaults: { tools: 'preset' } }, { adapters: { icqq: { summary: 'preset' } } }, { scenes: [{ address, models: { perception: 'preset' } }] }, { sessions: {} }, { connections: {} }]) assert.throws(() => readModelPolicyRefs(invalid))
  assert.deepEqual(readModelPolicyRefs({}), {})
  assert.deepEqual(readModelPolicyRefs({ defaults: {} }), { defaults: {} })
  const reordered = { conversation: { id: 'room', kind: 'channel', threadId: 'topic', parent: { id: 'guild', kind: 'channel' }, endpoint: { id: 'canonical\0id', adapter: 'adapter' } }, endpoint: 'account', platform: 'icqq', rootId: '/host' }
  assert.equal(policyAddressKey(address), policyAddressKey(reordered))
  assert.notEqual(policyAddressKey(address), policyAddressKey({ ...address, endpoint: 'another-account' }))
  assert.notEqual(policyAddressKey(address), policyAddressKey({ ...address, conversation: { ...address.conversation, threadId: 'another-topic' } }))
  const foreign = data(); foreign.targets.scenes[0].address = { ...address, rootId: '/another-host' }
  assert.throws(() => readModelPolicyView({ success: true, data: foreign }))
})

test('switches exactly the edited role from legacy fields to a preset and preserves authority and other roles', () => {
  const agents = { zhin: { provider: 'legacy', model: 'old', nickname: 'Zhin', permission: { tools: ['safe'] }, mcpServers: ['readonly'] }, other: { provider: 'other', model: 'other-model' } }
  const original = structuredClone(agents), next = selectAgentPreset(agents, 'zhin', 'current')
  assert.deepEqual(next.zhin, { preset: 'current', nickname: 'Zhin', permission: { tools: ['safe'] }, mcpServers: ['readonly'] })
  assert.deepEqual(next.other, original.other); assert.deepEqual(agents, original)
  assert.throws(() => selectAgentPreset(agents, 'missing', 'current'))
})

test('preset options derive only closed public metadata from the same AI draft', () => {
  const choices = deploymentPresetChoices({ modelCatalog: { connections: { c: { sdk: 'ollama', apiKey: 'SYNTHETIC-PRIVATE' } }, models: { m: { connectionId: 'c', model: 'chosen' } }, presets: { p: { modelId: 'm' } } } })
  assert.deepEqual(choices, [{ id: 'p', modelId: 'm', model: 'chosen', sdk: 'ollama' }])
  assert.equal(JSON.stringify(choices).includes('SYNTHETIC-PRIVATE'), false)
})

test('preserves conflict and unknown-write semantics for visible recovery', () => {
  assert.match(modelPolicyFailure(409), /版本已变化/)
  assert.match(modelPolicyFailure(503, 'commit_unknown', true), /尚未确认/)
  assert.match(modelPolicyFailure(undefined, undefined, true), /尚未确认/)
  assert.match(modelPolicyFailure(403), /无权/)
  assert.match(modelPolicyFailure(400), /无效/)
})
