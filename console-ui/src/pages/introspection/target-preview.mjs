import { readRendering } from '../endpoint-detail/rendering-diagnostics.mjs'

function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 }
export function readPreviewEndpoints(payload) {
  if (!payload || !Array.isArray(payload.endpoints)) throw new Error('目标 Endpoint 列表格式无效')
  return payload.endpoints.filter(item => item?.endpoint && nonempty(item.endpoint.id) && nonempty(item.endpoint.adapter))
    .map(item => ({ name: String(item.name ?? item.endpoint.id), connected: item.connected === true,
      endpoint: { id: item.endpoint.id, adapter: item.endpoint.adapter } }))
}
export function buildPreviewTarget(endpoint, fields) {
  if (!endpoint || !nonempty(endpoint.id) || !nonempty(endpoint.adapter)) throw new Error('请选择 Host 提供的 Endpoint 标识')
  if (!['private', 'group', 'channel'].includes(fields.kind) || !nonempty(fields.id)) throw new Error('请选择会话类型并填写会话 ID')
  if (Boolean(fields.parentKind) !== Boolean(fields.parentId?.trim())) throw new Error('父级类型和 ID 必须同时填写')
  if (fields.parentKind && !['private', 'group', 'channel'].includes(fields.parentKind)) throw new Error('父级类型无效')
  return { endpoint: { ...endpoint }, kind: fields.kind, id: fields.id.trim(),
    ...(fields.parentKind ? { parent: { kind: fields.parentKind, id: fields.parentId.trim() } } : {}),
    ...(fields.threadId?.trim() ? { threadId: fields.threadId.trim() } : {}) }
}
export function readPreviewResponse(body, target) {
  if (body?.success !== true || !body.data || !Object.hasOwn(body.data, 'output')) throw new Error(body?.error ?? '组件预览响应格式无效')
  const rendering = readRendering(body.data.rendering)
  if (target && !rendering) throw new Error('Host 未返回目标渲染诊断')
  return { output: body.data.output, rendering, generation: Number.isSafeInteger(body.data.generation) ? body.data.generation : undefined }
}

/** One card owns one active request; even an abort-ignoring old response cannot publish. */
export function createPreviewRequestGate() {
  let active, next = 0
  return {
    begin() {
      active?.controller.abort()
      const entry = { controller: new AbortController(), id: ++next }
      active = entry
      return { signal: entry.controller.signal, current: () => active === entry && !entry.controller.signal.aborted }
    },
    cancel() { active?.controller.abort(); active = undefined },
  }
}
