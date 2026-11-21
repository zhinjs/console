import { isPersonalSessionKey } from '../pages/personal-session-model.mjs'
import { formatConversationSessionKey } from '@zhin.js/console-protocol'
import { isKeyOnlySessionKey, parseImConversationKey } from './session-label.mjs'

/** 聊天记录（Agent 会话）sessionKey 与深链；格式与解析来自 @zhin.js/console-protocol 的 session-key（与 resolveIMSceneSessionId 一致） */

export type ImSessionScope = 'private' | 'group' | 'channel'

export interface ParsedImSessionKey {
  platform: string
  endpointId: string
  scope: ImSessionScope
  sceneId: string
}

export const SESSION_SCOPE_LABELS: Record<ImSessionScope, string> = {
  private: '私聊',
  group: '群聊',
  channel: '频道',
}

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
  return formatConversationSessionKey({ adapter: platform, endpointKey: endpointId, kind: scope, id: sceneId })
}

export function agentSessionsPath(sessionKey: string): string {
  const params = new URLSearchParams()
  params.set('sessionKey', sessionKey)
  return `/agent/sessions?${params}`
}

/** 从 URL 查询参数解析 sessionKey（避免重复 decode） */
export function parseSessionKeyFromQuery(raw: string | null): string {
  if (!raw) return ''
  // URLSearchParams.get already decoded the query. Percent sequences in the
  // identifier itself are literal data, not another URI encoding layer.
  return raw.trim()
}

/**
 * Accept a legacy IM key, or a key-only session: a complete hashed key (`personal-session:v1:`,
 * `scene-task:v1:` …) or `schedule:<id>`. Hashes never imply a conversation address.
 */
export function isLikelySessionKey(key: string): boolean {
  return isPersonalSessionKey(key) || isKeyOnlySessionKey(key) || parseImSessionKey(key) !== null
}

/**
 * 将内部 sessionKey 拆成 Console 可展示的会话上下文（`parseImConversationKey`：协议的解析，
 * 另外要求账号非空——协议接受的 `qq::private:1` 在这里仍是 null）。
 */
export function parseImSessionKey(key: string): ParsedImSessionKey | null {
  const parsed = parseImConversationKey(key)
  return parsed ? { platform: parsed.platform, endpointId: parsed.endpoint, scope: parsed.kind, sceneId: parsed.id } : null
}
