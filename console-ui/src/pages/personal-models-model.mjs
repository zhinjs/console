const SCOPES = new Set(['private', 'group', 'channel'])
const text = value => typeof value === 'string' && value.trim().length > 0
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export const PERSONAL_MODEL_SDKS = Object.freeze(['openai', 'anthropic', 'google', 'deepseek', 'minimax', 'ollama', 'openai-compatible'])
export function isPersonalSessionKey(value) { return typeof value === 'string' && /^personal-session:v1:[a-f0-9]{64}$/.test(value) }
export function readPersonalOwner(value) {
  if (!object(value) || !['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'].every(key => text(value[key]))) return null
  return Object.fromEntries(['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'].map(key => [key, value[key]]))
}
export function readPersonalAddress(value) {
  if (!object(value)) return null
  const conversation = value.conversation
  if (!object(conversation) || !object(conversation.endpoint) || !text(conversation.endpoint.adapter) || !text(conversation.endpoint.id)
    || !SCOPES.has(conversation.kind) || !text(conversation.id)
    || !['rootId', 'platform', 'endpoint', 'subjectId'].every(key => text(value[key]))) return null
  const parent = conversation.parent
  if (parent !== undefined && (!object(parent) || !SCOPES.has(parent.kind) || !text(parent.id))) return null
  if (conversation.threadId !== undefined && !text(conversation.threadId)) return null
  return { rootId: value.rootId, platform: value.platform, endpoint: value.endpoint, subjectId: value.subjectId,
    conversation: { endpoint: { adapter: conversation.endpoint.adapter, id: conversation.endpoint.id }, kind: conversation.kind, id: conversation.id,
      ...(parent ? { parent: { kind: parent.kind, id: parent.id } } : {}), ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}) } }
}
export function addressBelongsToOwner(address, owner) {
  return address.rootId === owner.rootId && address.platform === owner.platform && address.endpoint === owner.endpoint
    && address.subjectId === owner.subjectId && address.conversation.endpoint.id === owner.adapterId
}
export function readPersonalSessionRows(body, owner) {
  if (body?.success !== true || !Array.isArray(body.data?.rows) || typeof body.data.hasMore !== 'boolean') throw new Error('invalid_response')
  const rows = body.data.rows.map(row => {
    const address = readPersonalAddress(row?.address)
    if (!isPersonalSessionKey(row?.sessionKey) || !address || !addressBelongsToOwner(address, owner) || !Number.isFinite(row.updatedAt)) throw new Error('invalid_response')
    return { sessionKey: row.sessionKey, address, updatedAt: row.updatedAt }
  })
  return { rows, hasMore: body.data.hasMore }
}
export function personalSessionQuery(owner, offset = 0) {
  return `/api/agent/personal-sessions?${new URLSearchParams({ owner: JSON.stringify(owner), limit: '50', offset: String(offset) })}`
}
export function personalSessionAddressQuery(address) {
  return `/api/agent/personal-session?${new URLSearchParams({ address: JSON.stringify(address) })}`
}
export function readPersonalSessionView(body, sessionKey, address) {
  const state = body?.success === true ? body.data?.state : null
  const canonical = readPersonalAddress(state?.identity?.address)
  if (!isPersonalSessionKey(sessionKey) || state?.identity?.key !== sessionKey || !canonical || JSON.stringify(canonical) !== JSON.stringify(readPersonalAddress(address))
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || (state.selection?.kind !== 'inherit' && !(state.selection?.kind === 'preset' && text(state.selection.presetId)))
    || !Array.isArray(body.data?.presets?.personal) || !Array.isArray(body.data?.presets?.deployment)) throw new Error('invalid_response')
  const personal = body.data.presets.personal.map(value => {
    if (!text(value?.id) || !text(value.modelId)) throw new Error('invalid_response')
    return { id: value.id, modelId: value.modelId }
  })
  const deployment = body.data.presets.deployment.map(value => {
    if (!text(value?.id) || !text(value.modelId) || !text(value.model) || !text(value.sdk)) throw new Error('invalid_response')
    return { id: value.id, modelId: value.modelId, model: value.model, sdk: value.sdk, capabilities: capabilities(value.capabilities) }
  })
  return { state: { identity: { key: sessionKey, address: canonical }, revision: state.revision,
    selection: state.selection.kind === 'inherit' ? { kind: 'inherit' } : { kind: 'preset', presetId: state.selection.presetId } },
    presets: { personal, deployment } }
}
export function personalModelFailure(status, code) {
  if (status === 401) return '请先登录个人账号。'
  if (status === 403) return '当前账号尚未绑定此个人身份，请联系管理员。'
  if (status === 409) return '配置已被修改，请刷新后重试。'
  if (status === 503) return '个人模型存储尚未就绪，请联系管理员。'
  if (code === 'unknown-preset' || status === 404) return '所选模型预设不存在，未切换模型。'
  if (code === 'unsupported-capability') return '所选模型不支持此用途，未切换模型。'
  return '个人模型请求失败，请检查输入后重试。'
}

function capabilities(value) {
  if (!object(value)) throw new Error('invalid_response')
  const result = {}
  if (value.input !== undefined) {
    if (!Array.isArray(value.input) || value.input.some(item => !['text', 'image', 'audio', 'video', 'file'].includes(item))) throw new Error('invalid_response')
    result.input = [...value.input]
  }
  for (const key of ['streaming', 'toolCalling', 'thinking']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'boolean') throw new Error('invalid_response')
    result[key] = value[key]
  }
  return result
}
export function readPersonalModelsView(body) {
  if (body?.success !== true || !Array.isArray(body.data?.owners) || !Array.isArray(body.data.deployment)) throw new Error('invalid_response')
  const owners = body.data.owners.map(row => {
    const owner = readPersonalOwner(row?.owner)
    if (!owner || !text(row.ownerId) || !Number.isSafeInteger(row.revision) || row.revision < 0
      || !Array.isArray(row.connections) || !Array.isArray(row.models) || !Array.isArray(row.presets)) throw new Error('invalid_response')
    const connections = row.connections.map(connection => {
      if (!text(connection?.id) || !text(connection.sdk) || !Number.isSafeInteger(connection.revision) || connection.revision < 1
        || typeof connection.hasKey !== 'boolean' || (connection.baseUrl !== undefined && !text(connection.baseUrl))) throw new Error('invalid_response')
      return { id: connection.id, sdk: connection.sdk, revision: connection.revision, hasKey: connection.hasKey,
        ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }) }
    })
    const models = row.models.map(model => {
      if (!text(model?.id) || !text(model.model) || !connections.some(connection => connection.id === model.connectionId)) throw new Error('invalid_response')
      return { id: model.id, model: model.model, connectionId: model.connectionId, capabilities: capabilities(model.capabilities) }
    })
    const presets = row.presets.map(preset => {
      if (!text(preset?.id) || !models.some(model => model.id === preset.modelId)) throw new Error('invalid_response')
      return { id: preset.id, modelId: preset.modelId }
    })
    return { owner, ownerId: row.ownerId, revision: row.revision, connections, models, presets }
  })
  const deployment = body.data.deployment.map(preset => {
    if (!text(preset?.id) || !text(preset.modelId) || !text(preset.model) || !text(preset.sdk)) throw new Error('invalid_response')
    return { id: preset.id, modelId: preset.modelId, model: preset.model, sdk: preset.sdk, capabilities: capabilities(preset.capabilities) }
  })
  return { owners, deployment }
}

/** Matches createSdkProviderAdapter: Ollama can use a credential-free public HTTPS endpoint. */
export function personalModelRequiresApiKey(sdk, hasStoredKey = false) {
  return sdk !== 'ollama' && !hasStoredKey
}
/** Only entered credentials are submitted; no environment lookup or placeholder credential. */
export function personalModelEntry(input) {
  return { ...(input.presetId ? { presetId: input.presetId } : {}), sdk: input.sdk, baseUrl: input.baseUrl,
    model: input.model, capabilities: input.capabilities,
    ...(typeof input.apiKey === 'string' && input.apiKey.trim() ? { apiKey: input.apiKey } : {}) }
}
