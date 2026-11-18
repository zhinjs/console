import type { ConsoleMcpFailureCategory, ConsoleMcpServerStatus } from '../../contracts/mcp'

export const MCP_SERVER_STATUSES: readonly ConsoleMcpServerStatus[]
export const MCP_FAILURE_CATEGORIES: readonly ConsoleMcpFailureCategory[]
export const MCP_CONFIG_HREF: string

export interface McpFailureView {
  category: ConsoleMcpFailureCategory
  message: string
  exitCode?: number
  at?: number
}

export interface McpRowState {
  status: ConsoleMcpServerStatus | 'disconnected'
  tone: 'success' | 'destructive' | 'secondary' | 'outline'
  dot: 'is-online' | 'is-offline' | 'is-idle'
  label: string
  detail: string
  failure: McpFailureView | null
}

export type McpTestResultView =
  | { ok: true; name: string; toolCount: number; durationMs: number | null }
  | { ok: false; name: string; failure: McpFailureView | null; durationMs: number | null }

export type McpTestOutcome =
  | { kind: 'result'; result: McpTestResultView }
  | {
    kind: 'error'
    reason: 'forbidden' | 'not_found' | 'busy' | 'rate_limited' | 'agent_unavailable' | 'network' | 'error'
    status: number
    retryAfterSec: number | null
    message: string
  }

export interface McpTestPresentation {
  tone: 'success' | 'destructive' | 'warning'
  role: 'status' | 'alert'
  label: string
  detail: string
}

type Locale = 'zh-CN' | 'en'

export function readMcpFailure(value: unknown): McpFailureView | null
export function mcpFailureText(failure: McpFailureView | null, locale?: Locale): string
export function mcpFailureCategoryLabel(category: string, locale?: Locale): string
export function mcpRowState(row: unknown, locale?: Locale): McpRowState
export function isStdioMcp(row: unknown): boolean
export function retryAfterSecondsFrom(header: string | null | undefined, now?: number): number | null
export function readMcpTestResult(data: unknown): McpTestResultView | null
export function readMcpTestResponse(input: { status: number; body: unknown; retryAfter?: string | null; now?: number }): McpTestOutcome
export function mcpTestRequestError(message: string): McpTestOutcome
export function mcpTestPresentation(outcome: McpTestOutcome, locale?: Locale): McpTestPresentation
export function countFailedMcp(rows: unknown): number | null

export interface McpSummary {
  total: number
  connected: number
  statusAware: boolean
  /** null when the rows carry no `status` (older Host). */
  failed: number | null
  idle: number
  notLoaded: number
  /** Servers that need attention: failed ones, or (older Host) total − connected. */
  problems: number
}
export function summarizeMcp(rows: unknown, total?: number | null): McpSummary
export function mcpDashboardDetail(summary: McpSummary, locale?: Locale): string
export function mcpWorkbenchCopy(summary: McpSummary, locale?: Locale): { detail: string; headline: string | null; missing: string | null }
