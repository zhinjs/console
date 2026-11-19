export interface RecentSession {
  sessionKey: string; turns: number; lastAt: number; lastStatus: string
  /** Present only when the Host sends them next to the key. */
  platform?: string; scopeKind?: string; sceneLabel?: string; displayName?: string
}
export function readRecentSessions(body: unknown, limit?: number): RecentSession[]
export function relativeSince(timestamp: number, now?: number, locale?: 'zh-CN' | 'en'): string
/** `others`: scheduled tasks, HTTP / A2A sessions and sessions of unknown kind. */
export interface RecentSessionSummary { sessions: number; turns: number; active: number; groups: number; privates: number; others: number; failed: number }
export function summarizeRecentSessions(body: unknown, now?: number): RecentSessionSummary | null
