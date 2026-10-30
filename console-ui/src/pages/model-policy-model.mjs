const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0 && value === value.trim()
function closed(value, fields) {
  if (!record(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('invalid_response')
  return value
}
function strings(value, fields, required = fields) {
  closed(value, fields)
  if (required.some(key => !text(value[key])) || Object.entries(value).some(([key, item]) => !text(item))) throw new Error('invalid_response')
}
function patch(value, fields) { strings(value, fields, []) }
function conversation(value) {
  closed(value, ['endpoint', 'kind', 'id', 'parent', 'threadId'])
  strings(value.endpoint, ['adapter', 'id'])
  if (!['private', 'group', 'channel'].includes(value.kind) || !text(value.id)) throw new Error('invalid_response')
  if (value.parent !== undefined) { strings(value.parent, ['kind', 'id']); if (!['private', 'group', 'channel'].includes(value.parent.kind)) throw new Error('invalid_response') }
  if (value.threadId !== undefined && !text(value.threadId)) throw new Error('invalid_response')
}
export function readModelPolicyRefs(value) {
  closed(value, ['defaults', 'adapters', 'endpoints', 'scenes'])
  if (value.defaults !== undefined) patch(value.defaults, ['chat', 'perception', 'summary'])
  if (value.adapters !== undefined) {
    if (!record(value.adapters)) throw new Error('invalid_response')
    for (const [id, entry] of Object.entries(value.adapters)) { if (!text(id)) throw new Error('invalid_response'); patch(entry, ['chat', 'perception']) }
  }
  for (const [name, scene] of [['endpoints', false], ['scenes', true]]) {
    if (value[name] === undefined) continue
    if (!Array.isArray(value[name])) throw new Error('invalid_response')
    for (const entry of value[name]) {
      closed(entry, ['address', 'models'])
      closed(entry.address, scene ? ['rootId', 'platform', 'endpoint', 'conversation'] : ['rootId', 'platform', 'endpoint', 'adapterId'])
      for (const field of ['rootId', 'platform', 'endpoint', ...(scene ? [] : ['adapterId'])]) if (!text(entry.address[field])) throw new Error('invalid_response')
      if (scene) conversation(entry.address.conversation)
      patch(entry.models, scene ? ['chat'] : ['chat', 'perception'])
    }
  }
  return structuredClone(value)
}
export function readModelPolicyView(body) {
  if (!record(body) || body.success !== true) throw new Error('invalid_response')
  const data = closed(body.data, ['revision', 'refsOverride', 'baseline', 'rootId', 'presets', 'targets'])
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !text(data.rootId) || !Array.isArray(data.presets)) throw new Error('invalid_response')
  const presets = data.presets.map(value => { strings(value, ['id', 'modelId', 'model', 'sdk']); return { id: value.id, modelId: value.modelId, model: value.model, sdk: value.sdk } })
  if (new Set(presets.map(value => value.id)).size !== presets.length) throw new Error('invalid_response')
  return { revision: data.revision, refsOverride: readModelPolicyRefs(data.refsOverride), baseline: readModelPolicyRefs(data.baseline), rootId: data.rootId, presets, ...(data.targets === undefined ? {} : { targets: readPolicyTargets(data.targets, data.rootId) }) }
}
export function modelPolicyFailure(status, code, writing = false) {
  if (code === 'commit_unknown' || (writing && (!status || status >= 500))) return '提交结果尚未确认，请重新读取核实后再操作。'
  if (status === 409) return '模型策略版本已变化，请重新读取后再保存。'
  if (status === 403) return '当前身份无权管理部署模型策略。'
  if (status === 400) return '模型策略无效，请检查预设引用和作用域。'
  return '模型策略暂时无法读取，请稍后重新读取。'
}
function readPolicyTargets(value, rootId) {
  closed(value, ['adaptersAvailable', 'adapters', 'endpoints', 'scenesAvailable', 'scenesError', 'scenes', 'sceneHasMore'])
  for (const key of ['adaptersAvailable', 'scenesAvailable', 'sceneHasMore']) if (typeof value[key] !== 'boolean') throw new Error('invalid_response')
  for (const key of ['adapters', 'endpoints', 'scenes']) if (!Array.isArray(value[key])) throw new Error('invalid_response')
  for (const item of value.adapters) strings(item, ['capabilityId', 'platform'])
  for (const item of value.endpoints) {
    closed(item, ['capabilityId', 'instanceId', 'address']); strings({ capabilityId: item.capabilityId, instanceId: item.instanceId }, ['capabilityId', 'instanceId'])
    readModelPolicyRefs({ endpoints: [{ address: item.address, models: {} }] })
    if (item.address.rootId !== rootId) throw new Error('invalid_response')
  }
  for (const item of value.scenes) {
    closed(item, ['address']); readModelPolicyRefs({ scenes: [{ address: item.address, models: {} }] })
    if (item.address.rootId !== rootId) throw new Error('invalid_response')
  }
  if (value.scenesError !== undefined && !['not_requested', 'unavailable', 'integrity'].includes(value.scenesError)) throw new Error('invalid_response')
  return structuredClone(value)
}
export function policyAddressKey(address) {
  const conversation = address.conversation
  return conversation ? JSON.stringify([address.rootId, address.platform, address.endpoint, conversation.endpoint.adapter, conversation.endpoint.id,
    conversation.kind, conversation.id, conversation.parent?.kind ?? null, conversation.parent?.id ?? null, conversation.threadId ?? null])
    : JSON.stringify([address.rootId, address.platform, address.endpoint, address.adapterId])
}

/** Only the role explicitly switched by the user loses its legacy model fields. */
export function selectAgentPreset(agents, role, presetId) {
  if (!record(agents) || !Object.hasOwn(agents, role) || !record(agents[role]) || !text(presetId)) throw new Error('invalid_role')
  const { provider, model, ...authority } = agents[role]
  return { ...agents, [role]: { ...authority, preset: presetId } }
}
export function deploymentPresetChoices(ai) {
  if (!record(ai?.modelCatalog)) return []
  const catalog = ai.modelCatalog
  if (!record(catalog.presets) || !record(catalog.models) || !record(catalog.connections)) return []
  return Object.entries(catalog.presets).flatMap(([id, preset]) => {
    const model = record(preset) && catalog.models[preset.modelId]
    const connection = record(model) && catalog.connections[model.connectionId]
    return record(connection) && text(id) && text(model.model) && text(connection.sdk) ? [{ id, modelId: preset.modelId, model: model.model, sdk: connection.sdk }] : []
  })
}
