import type { DiagnosticConversation } from './types'
import type { RenderingDiagnostic } from './rendering-diagnostics.mjs'
export interface DiagnosticTarget { conversation: DiagnosticConversation; messageId?: string }
export interface MessageDiagnostic {
  id: string; generation: number; conversation: DiagnosticConversation; messageId?: string
  startedAt: number; endedAt?: number; status: 'processing' | 'completed' | 'failed'
  truncated: boolean
  route?: string; command?: string; dispatchStatus?: string
  limit?: { reason: 'cooldown' | 'busy' | 'capacity' | 'operation_unavailable' | 'identity_unavailable' | 'service_unavailable'; retryAfterMs?: number }
  steps: Array<{ stage: string; status: string; at: number }>
  deliveries: Array<{ conversation: DiagnosticConversation; status: string; failureCode?: string; deliveryUnknown?: boolean; rendering?: RenderingDiagnostic }>
}
export const DIAGNOSTIC_RETENTION: string
export function validDiagnosticConversation(value: unknown): value is DiagnosticConversation
export function diagnosticConversationKey(value: unknown): string | undefined
export function diagnosticTarget(message: unknown, locale?: 'zh-CN' | 'en'): DiagnosticTarget | { reason: string }
export function conversationDiagnosticTarget(endpoint: unknown, selection: unknown, locale?: 'zh-CN' | 'en'): DiagnosticTarget | { reason: string }
export function diagnosticQuery(target: DiagnosticTarget, locale?: 'zh-CN' | 'en'): string
export function readMessageDiagnostics(body: unknown, target: DiagnosticTarget, locale?: 'zh-CN' | 'en'): MessageDiagnostic[]
export function diagnosticLabel(value?: string, locale?: 'zh-CN' | 'en'): string
export function diagnosticAdvice(record: MessageDiagnostic, locale?: 'zh-CN' | 'en'): string[]
export function createDiagnosticRequestGate(readScope?: () => string | undefined): { begin(): { signal: AbortSignal; current(): boolean }; cancel(): void }
