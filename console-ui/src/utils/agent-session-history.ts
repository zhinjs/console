const HISTORY_KEY = 'zhin_agent_session_keys'
const MAX_HISTORY = 10

export function loadAgentSessionHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function saveAgentSessionHistory(keys: string[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(keys.slice(0, MAX_HISTORY)))
}

export function pushAgentSessionHistory(key: string): string[] {
  const trimmed = key.trim()
  if (!trimmed) return loadAgentSessionHistory()
  const prev = loadAgentSessionHistory().filter((k) => k !== trimmed)
  const next = [trimmed, ...prev].slice(0, MAX_HISTORY)
  saveAgentSessionHistory(next)
  return next
}
