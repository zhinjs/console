/** 对话分支 sessionKey 与深链（与 @zhin.js/ai resolveIMSessionId 一致） */

export type ImSessionScope = 'private' | 'group' | 'channel'

/**
 * IM 会话 sessionKey，格式：`{platform}:{endpointId}:{scope}:{sceneId}`
 * 例：icqq:75318:private:userA
 */
export function buildSessionKey(
  platform: string,
  endpointId: string,
  scope: ImSessionScope,
  sceneId: string,
): string {
  return `${platform}:${endpointId}:${scope}:${sceneId}`
}

export function agentSessionsPath(sessionKey: string): string {
  const params = new URLSearchParams()
  params.set('sessionKey', sessionKey)
  return `/agent/sessions?${params}`
}

/** 从 URL 查询参数解析 sessionKey（避免重复 decode） */
export function parseSessionKeyFromQuery(raw: string | null): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/** 是否为合法 sessionKey 形态（四段，含 scope） */
export function isLikelySessionKey(key: string): boolean {
  const parts = key.split(':')
  if (parts.length < 4) return false
  const scope = parts[2]
  return scope === 'private' || scope === 'group' || scope === 'channel'
}
