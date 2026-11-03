const SCOPES = new Set(['private', 'group', 'channel'])
const text = (value) => typeof value === 'string' && value.trim().length > 0
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
export function isPersonalSessionKey(value) {
  return typeof value === 'string' && /^personal-session:v1:[a-f0-9]{64}$/.test(value)
}
export function readPersonalOwner(value) {
  if (
    !object(value) ||
    !['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'].every((key) => text(value[key]))
  )
    return null
  return Object.fromEntries(
    ['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'].map((key) => [key, value[key]])
  )
}
export function readPersonalAddress(value) {
  if (!object(value)) return null
  const conversation = value.conversation
  if (
    !object(conversation) ||
    !object(conversation.endpoint) ||
    !text(conversation.endpoint.adapter) ||
    !text(conversation.endpoint.id) ||
    !SCOPES.has(conversation.kind) ||
    !text(conversation.id) ||
    !['rootId', 'platform', 'endpoint', 'subjectId'].every((key) => text(value[key]))
  )
    return null
  const parent = conversation.parent
  if (parent !== undefined && (!object(parent) || !SCOPES.has(parent.kind) || !text(parent.id)))
    return null
  if (conversation.threadId !== undefined && !text(conversation.threadId)) return null
  return {
    rootId: value.rootId,
    platform: value.platform,
    endpoint: value.endpoint,
    subjectId: value.subjectId,
    conversation: {
      endpoint: { adapter: conversation.endpoint.adapter, id: conversation.endpoint.id },
      kind: conversation.kind,
      id: conversation.id,
      ...(parent ? { parent: { kind: parent.kind, id: parent.id } } : {}),
      ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
    },
  }
}
export function addressBelongsToOwner(address, owner) {
  return (
    address.rootId === owner.rootId &&
    address.platform === owner.platform &&
    address.endpoint === owner.endpoint &&
    address.subjectId === owner.subjectId &&
    address.conversation.endpoint.id === owner.adapterId
  )
}
export function readPersonalSessionRows(body, owner) {
  if (
    body?.success !== true ||
    !Array.isArray(body.data?.rows) ||
    typeof body.data.hasMore !== 'boolean'
  )
    throw new Error('invalid_response')
  const rows = body.data.rows.map((row) => {
    const address = readPersonalAddress(row?.address)
    if (
      !isPersonalSessionKey(row?.sessionKey) ||
      !address ||
      !addressBelongsToOwner(address, owner) ||
      !Number.isFinite(row.updatedAt)
    )
      throw new Error('invalid_response')
    return { sessionKey: row.sessionKey, address, updatedAt: row.updatedAt }
  })
  return { rows, hasMore: body.data.hasMore }
}
export function readPersonalSessionState(state, sessionKey, address) {
  const canonical = readPersonalAddress(state?.identity?.address)
  if (
    !isPersonalSessionKey(sessionKey) ||
    state?.identity?.key !== sessionKey ||
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(readPersonalAddress(address)) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  )
    throw new Error('invalid_response')
  const selection = state.selection
  if (
    selection?.kind !== 'inherit' &&
    !(
      selection?.kind === 'profile' &&
      text(selection.profile?.id) &&
      selection.profile.rootId === address.rootId &&
      text(selection.profile.accountId) &&
      text(selection.profile.accountIncarnation) &&
      selection.profile.kind === 'language'
    )
  )
    throw new Error('invalid_response')
  return {
    identity: { key: sessionKey, address: canonical },
    revision: state.revision,
    selection:
      selection.kind === 'inherit'
        ? { kind: 'inherit' }
        : {
            kind: 'profile',
            profile: {
              id: selection.profile.id,
              rootId: selection.profile.rootId,
              accountId: selection.profile.accountId,
              accountIncarnation: selection.profile.accountIncarnation,
              kind: 'language',
            },
          },
  }
}
