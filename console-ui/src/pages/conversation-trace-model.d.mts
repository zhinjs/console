import type { DiagnosticConversation } from './endpoint-detail/types'
export type UsageKey = 'input' | 'output' | 'totalTokens' | 'cacheRead' | 'cacheWrite' | 'reasoning'
export interface TraceCall { request_id?: string; index?: number; provider?: string; model?: string; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number; reasoning_tokens?: number; duration_ms?: number; stop_reason?: string; reported?: Partial<Record<UsageKey, boolean>> }
export interface ContextBudget { total_tokens: number; segments: Record<string, number>; sections?: Array<{ id: string; tokens: number }> }
export interface TraceTurn { turn_id: string; session_key: string; started_at: number; duration_ms?: number; total_tokens?: number; model_calls: number; tool_calls: number; request_count?: number; termination: { status: string; reason?: string }; origin?: { conversation: DiagnosticConversation; messageId?: string }; usage_calls?: TraceCall[]; context_budget?: ContextBudget }
export interface TraceRequest { request_id: string; index: number; provider?: string; model?: string; started_at: number; status: string; duration_ms?: number; stop_reason?: string; body_status: string; usage?: TraceCall; estimated_tokens?: { basis?: string; system: number; messages: number; tools: number; output_schema: number; total: number }; body?: { system?: string; messages: Array<{ role: string; content: unknown }>; tools: Array<{ name: string; description?: string; input_schema?: unknown }>; output_schema?: unknown } }
export interface TraceDetail { turn_id: string; session_key: string; started_at: number; duration_ms?: number; model_calls: TraceCall[]; tool_calls: Array<{ tool_use_id: string; tool_name: string; args_summary: string; status: string; duration_ms?: number; error?: string }>; subagents: TraceDetail[]; requests?: TraceRequest[]; context_budget?: ContextBudget; termination: { status: string; reason?: string } }
export interface TraceMetric { value: number | null; partial: boolean }
export const contextLabels: Record<string, string>
export function traceQuery(kind: 'turns' | 'turn' | 'request', sessionKey: string, turnId?: string, requestId?: string, conversation?: DiagnosticConversation): string
export function readTraceTurns(body: unknown, sessionKey: string, locale?: 'zh-CN' | 'en', conversation?: DiagnosticConversation): TraceTurn[]
export function readTraceDetail(body: unknown, sessionKey: string, turnId: string, locale?: 'zh-CN' | 'en', conversation?: DiagnosticConversation): TraceDetail
export function readTraceRequest(body: unknown, sessionKey: string, turnId: string, requestId: string, locale?: 'zh-CN' | 'en'): TraceRequest
export function traceUsage(turns: Array<Pick<TraceTurn, 'usage_calls' | 'total_tokens'>>): Record<UsageKey | 'uncachedInput', TraceMetric>
export function formatTraceMetric(metric: TraceMetric, locale?: 'zh-CN' | 'en'): string
export function turnsForMessage(turns: TraceTurn[], ref: { conversation: DiagnosticConversation; id: string }): TraceTurn[]
export function traceFailure(status: number, locale?: 'zh-CN' | 'en'): string
export function traceStatus(status: string, locale?: 'zh-CN' | 'en'): string
export function traceBodyStatus(status: string, locale?: 'zh-CN' | 'en'): string
export function promptContent(content: unknown): string
