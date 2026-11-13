export type SelfCheckId = 'api' | 'base-path' | 'mixed' | 'clock' | 'auth' | 'events' | 'websocket'
export type SelfCheckStatus = 'pass' | 'fail' | 'warn' | 'skip'
export interface SelfCheckResult { readonly id: SelfCheckId; readonly status: SelfCheckStatus; readonly detail?: string; readonly values?: readonly string[] }
export interface SelfCheckDeps {
  fetch: typeof fetch
  WebSocket?: new (url: string) => { onopen: (() => void) | null; onclose: ((event: { code: number }) => void) | null; onerror: (() => void) | null; close(): void }
  apiBase: string
  pageHref: string
  pageProtocol: string
  token?: string | null
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(id: unknown): void
  /** Run the WebSocket upgrade probe too (it writes one terminal.denied audit entry). */
  includeWebSocket?: boolean
}
export const SELF_CHECK_IDS: readonly SelfCheckId[]
export const CLOCK_SKEW_LIMIT_MS: number
export const SELF_CHECK_TIMEOUT_MS: number
type Translate = (message: string, values?: readonly unknown[]) => string
export function selfCheckCopy(id: SelfCheckId, t: Translate): Readonly<{ title: string; explain: string; fix: string }>
export function selfCheckDetail(check: SelfCheckResult | null | undefined, t: Translate): string | null
export function checkMixedContent(pageProtocol: string, apiBase: string): SelfCheckResult
export function checkHealthReply(reply: { status?: number; contentType?: string | null; body?: unknown; error?: unknown } | null): SelfCheckResult[]
export function checkClockSkew(serverTimestamp: unknown, sentAt: number, receivedAt: number): SelfCheckResult
export function checkAuthReply(reply: { status?: number; body?: unknown; error?: unknown } | null, hasCredential?: boolean): SelfCheckResult
export function checkEventStreamReply(reply: { status?: number; contentType?: string | null; firstChunk?: boolean; error?: unknown } | null, waitedSeconds?: number, instanceReady?: boolean): SelfCheckResult
export function checkWebSocketOutcome(outcome: { opened?: boolean; code?: number; timeout?: boolean; unavailable?: boolean } | null): SelfCheckResult
export function selfCheckSocketUrl(apiBase: string, pageHref: string): string
export function runSelfChecks(deps: SelfCheckDeps, onResult?: (check: SelfCheckResult) => void): Promise<SelfCheckResult[]>
export function selfCheckSummary(results: readonly SelfCheckResult[]): Readonly<{ status: 'pass' | 'warn' | 'fail'; failed: number; warned: number }>
export function runWebSocketCheck(deps: SelfCheckDeps): Promise<SelfCheckResult>
