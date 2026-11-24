export interface RecentSession {
  sessionKey: string; turns: number; lastAt: number; lastStatus: string
  /** Present only when the Host sends them next to the key. */
  platform?: string; scopeKind?: string; sceneLabel?: string; displayName?: string
  /** The group the row is about (recorded origin or address key), for looking up its name. */
  group?: { adapter: string; id: string }
}
export function readRecentSessions(body: unknown, limit?: number): RecentSession[]
export function relativeSince(timestamp: number, now?: number, locale?: 'zh-CN' | 'en'): string
/** `others`: scheduled tasks, HTTP / A2A sessions and sessions of unknown kind. */
export interface RecentSessionSummary { sessions: number; turns: number; active: number; groups: number; privates: number; others: number; failed: number }
export function summarizeRecentSessions(body: unknown, now?: number): RecentSessionSummary | null
/** Whether a group in the rows shows only its number (#64 `session-group-name-missing`). */
export function sessionsNeedingGroupNames(rows: readonly RecentSession[] | null | undefined): boolean
/** Rows whose group shows only its number get its name from `names` (「平台:群号」 → 群名). */
export function withGroupNames(rows: RecentSession[], names: ReadonlyMap<string, string> | null | undefined): RecentSession[]
