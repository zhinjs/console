import type { Locale } from '../i18n/locale.mjs'

/** Whatever a page knows about a session; only `sessionKey` is required. */
export interface SessionLabelSource {
  sessionKey: string
  platform?: string
  endpoint?: string
  scope?: string
  sceneId?: string
  scopeKind?: string
  sceneLabel?: string
  displayName?: string
  label?: string
  name?: string
  shortKey?: string
}

export function middleEllipsis(text: string, max?: number): string
export function splitSessionKey(row: Pick<SessionLabelSource, 'sessionKey' | 'platform' | 'endpoint' | 'scope' | 'sceneId'>): { sessionKey: string; platform: string; endpoint: string; scope: string; sceneId: string }
export function parseImConversationKey(key: unknown): { platform: string; endpoint: string; kind: 'private' | 'group' | 'channel'; id: string } | null
export function scheduleIdOfKey(sessionKey: unknown): string
export function isHashedSessionKey(sessionKey: unknown): boolean
export function isKeyOnlySessionKey(sessionKey: unknown): boolean
export function sessionKind(row: Partial<SessionLabelSource> | null | undefined): string
export function sessionLabel(row: SessionLabelSource, locale?: Locale): string
export function sessionShortKey(row: Partial<SessionLabelSource> | null | undefined): string
export function scheduleNamesFromList(data: unknown): Map<string, string>
export function withScheduleName<T extends { sessionKey: string; sceneLabel?: string; scopeKind?: string }>(row: T, names: ReadonlyMap<string, string> | null | undefined): T
