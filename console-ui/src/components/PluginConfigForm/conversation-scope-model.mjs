import { objectFields, updateObjectField } from './schema-model.mjs'
import { buildPreviewTarget } from '../../pages/introspection/target-preview.mjs'

export const CONVERSATION_KINDS = ['private', 'group', 'channel']
export const CONVERSATION_KIND_LABELS = { private: '私聊', group: '群聊', channel: '频道' }
export function isConversationScopeField(field) {
  return field?.type === 'list' && (field.component === 'conversation-scope' || field['x-zhin-config']?.component === 'conversation-scope')
}
export function scopeAllowedKinds(field) {
  const kind = objectFields(field?.inner).kind
  const declared = kind?.enum ?? kind?.options?.map(option => option.value)
  return Array.isArray(declared) ? CONVERSATION_KINDS.filter(value => declared.includes(value)) : [...CONVERSATION_KINDS]
}
export function endpointKey(endpoint) {
  return endpoint && typeof endpoint.id === 'string' && typeof endpoint.adapter === 'string'
    ? JSON.stringify({ id: endpoint.id, adapter: endpoint.adapter }) : ''
}
export function targetDraft(value) {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const endpoint = object.endpoint && typeof object.endpoint === 'object' && !Array.isArray(object.endpoint) ? object.endpoint : {}
  const parent = object.parent && typeof object.parent === 'object' && !Array.isArray(object.parent) ? object.parent : {}
  return { endpoint, kind: typeof object.kind === 'string' ? object.kind : '', id: typeof object.id === 'string' ? object.id : '',
    parentKind: typeof parent.kind === 'string' ? parent.kind : '', parentId: typeof parent.id === 'string' ? parent.id : '',
    threadId: typeof object.threadId === 'string' ? object.threadId : '' }
}
export function updateTargetField(value, field, child) { return updateObjectField(value, field, child) }
export function updateTargetParent(value, field, child) {
  return updateObjectField(value, 'parent', updateObjectField(value?.parent, field, child))
}
export function targetDraftIssue(value, allowedKinds = CONVERSATION_KINDS) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '目标尚不是完整对象，请填写目标并交由 Host 校验。'
    const draft = targetDraft(value)
    if (!allowedKinds.includes(draft.kind)) return '请选择此字段允许的会话类型。'
    if (value.parent !== undefined && (!draft.parentKind || !draft.parentId.trim())) return '父容器类型和 ID 必须同时填写；没有父容器时请明确移除。'
    if (value.threadId !== undefined && !draft.threadId.trim()) return '话题 ID 不能为空；没有话题时请明确移除。'
    buildPreviewTarget(draft.endpoint, draft)
    return null
  } catch (error) { return error instanceof Error ? error.message : '目标身份不完整，以 Host 校验为准。' }
}
/** Read requests may finish after unmount or a credential change; never publish those results. */
export function createScopeReadGate(readScope) {
  let epoch = 0
  return {
    begin() { const own = ++epoch, scope = readScope(); return { scope, current: () => !!scope && own === epoch && readScope() === scope } },
    cancel() { epoch++ },
  }
}
