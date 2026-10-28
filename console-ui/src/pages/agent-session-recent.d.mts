export interface RecentSession { sessionKey: string; turns: number; lastAt: number; lastStatus: string }
export function readRecentSessions(body: unknown, limit?: number): RecentSession[]
export function relativeSince(timestamp: number, now?: number, locale?: 'zh-CN' | 'en'): string
