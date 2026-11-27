/**
 * The overview page's soft-card lists (the Main design): 聊天账号 rows with one status word each,
 * and 最近会话 — the latest message of each conversation, newest first. Pure functions.
 *
 * Status words follow the design's glossary (账号：在线 / 连接中 / 待登录 / 离线); colors are the
 * library's status tones (StatusDot), not category colors.
 */

/** StatusDot tone of an account row: 待登录 warn, 在线 ok, 连接中 progress, 离线 neutral. */
export function endpointStatusTone(endpoint) {
  if (endpoint?.pendingLogin) return 'warn'
  if (endpoint?.connected || endpoint?.status === 'online') return 'ok'
  if (endpoint?.transportState === 'connecting' || endpoint?.transportState === 'reconnecting') return 'progress'
  return 'neutral'
}

/** The one status word of an account row (`t` translates the Chinese source). */
export function endpointStatusLabel(endpoint, t = (text) => text) {
  const tone = endpointStatusTone(endpoint)
  return tone === 'warn' ? t('待登录') : tone === 'ok' ? t('在线') : tone === 'progress' ? t('连接中') : t('离线')
}

/** The latest record of each conversation, newest first, at most `limit`. */
export function latestConversations(records, limit = 4) {
  const seen = new Map()
  for (const record of records ?? []) {
    if (!record) continue
    const key = record.conversationKey || `${record.adapter}/${record.endpoint}/${record.kind}/${record.channelId}`
    const previous = seen.get(key)
    if (!previous || record.timestamp >= previous.timestamp) seen.set(key, record)
  }
  return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, Math.max(0, limit))
}
