import { translate } from '../../i18n/locale.mjs'
const FORM_LABELS = Object.freeze({ text: '文本', image: '图片', native: '平台原生内容' })
const FALLBACK_LABELS = Object.freeze({ renderer_unavailable: '截图服务不可用', renderer_failed: '截图渲染失败', media_unsupported: '目标不支持该媒体', html_text_policy: 'HTML 按文本策略降级', markdown_text_policy: 'Markdown 按文本策略降级', interactive_text_policy: '按钮按文本策略降级' })

export function readRendering(value, locale = 'zh-CN') {
  if (value === undefined) return undefined
  if (!value || !Array.isArray(value.forms) || !Array.isArray(value.fallbacks)
    || value.forms.length > 3 || value.fallbacks.length > 6
    || !value.forms.every(item => Object.hasOwn(FORM_LABELS, item))
    || !value.fallbacks.every(item => Object.hasOwn(FALLBACK_LABELS, item))) throw new Error(translate(locale, "渲染诊断格式无效"))
  return { forms: [...new Set(value.forms)], fallbacks: [...new Set(value.fallbacks)] }
}

export function renderingLabels(value, locale = 'zh-CN') {
  const rendering = readRendering(value, locale)
  return rendering ? { forms: rendering.forms.map(form => translate(locale, FORM_LABELS[form])), fallbacks: rendering.fallbacks.map(reason => translate(locale, FALLBACK_LABELS[reason])) } : undefined
}

function identity(value) {
  return JSON.stringify([value.channelType, value.channelId, value.parent?.kind ?? (value.parent?.type === 'guild' ? 'channel' : value.parent?.type) ?? '', value.parent?.id ?? '', value.threadId ?? ''])
}
export function matchesMessageConversation(message, selection) {
  return selection?.type === 'channel' && identity(message) === identity({ channelType: selection.channelType, channelId: selection.id, parent: selection.parent, threadId: selection.threadId })
}

/** Keep exact IDs/direction. A newer SSE diagnostic enriches, rather than duplicates, its local send. */
export function correlateChatRows(rows, limit = 500) {
  const merged = new Map()
  for (const row of rows) {
    const key = row.messageId ? JSON.stringify([row.endpoint?.adapter ?? '', row.endpoint?.id ?? '', identity(row), !!row.outgoing, row.messageId]) : row.id
    const previous = merged.get(key)
    if (!previous) { merged.set(key, row); continue }
    const local = row.local ? row : previous.local ? previous : row
    merged.set(key, { ...previous, ...row, id: previous.id, content: local.content,
      rendering: row.rendering ?? previous.rendering, local: previous.local || row.local })
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit)
}

export function readMessagePush(payload, locale = 'zh-CN') {
  const conversation = payload?.conversation
  if (!payload || !['inbound', 'outbound'].includes(payload.direction) || !['private', 'group', 'channel'].includes(conversation?.kind)
    || typeof conversation?.endpoint?.adapter !== 'string' || typeof conversation?.endpoint?.id !== 'string'
    || typeof conversation.id !== 'string' || !conversation.id || !Number.isFinite(payload.timestamp)) return undefined
  if (conversation.parent && (!['private', 'group', 'channel'].includes(conversation.parent.kind) || typeof conversation.parent.id !== 'string')) return undefined
  if (conversation.threadId !== undefined && typeof conversation.threadId !== 'string') return undefined
  let rendering, renderingError
  try { rendering = readRendering(payload.rendering, locale) } catch (error) { renderingError = error.message }
  return { ...payload, endpoint: { ...conversation.endpoint }, channelId: conversation.id, channelType: conversation.kind,
    parent: conversation.parent ? { type: conversation.parent.kind === 'channel' ? 'guild' : conversation.parent.kind, id: conversation.parent.id } : undefined,
    threadId: conversation.threadId, outgoing: payload.direction === 'outbound', rendering, renderingError,
    messageId: typeof payload.messageId === 'string' && payload.messageId ? payload.messageId : undefined }
}
