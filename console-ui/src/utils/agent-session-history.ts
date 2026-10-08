import { getApiBase } from './auth'

// 会话属于具体 Host；旧全局历史无法安全推断归属，保留但不读取。
function historyKey(): string {
  return `zhin_agent_session_keys:${encodeURIComponent(getApiBase())}`
}
const MAX_HISTORY = 10

export function loadAgentSessionHistory(): string[] {
  try {
    const raw = localStorage.getItem(historyKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function saveAgentSessionHistory(keys: string[]): void {
  localStorage.setItem(historyKey(), JSON.stringify(keys.slice(0, MAX_HISTORY)))
}

export function pushAgentSessionHistory(key: string): string[] {
  const trimmed = key.trim()
  if (!trimmed) return loadAgentSessionHistory()
  const prev = loadAgentSessionHistory().filter((k) => k !== trimmed)
  const next = [trimmed, ...prev].slice(0, MAX_HISTORY)
  saveAgentSessionHistory(next)
  return next
}
