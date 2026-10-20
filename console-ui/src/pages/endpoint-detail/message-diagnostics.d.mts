import type { DiagnosticConversation } from './types'
import type { RenderingDiagnostic } from './rendering-diagnostics.mjs'
export interface DiagnosticTarget { conversation: DiagnosticConversation; messageId?: string }
export interface MessageDiagnostic {
  id: string; generation: number; conversation: DiagnosticConversation; messageId?: string
  startedAt: number; endedAt?: number; status: 'processing' | 'completed' | 'failed'
  truncated: boolean
  route?: string; command?: string; dispatchStatus?: string
  steps: Array<{ stage: string; status: string; at: number }>
  deliveries: Array<{ conversation: DiagnosticConversation; status: string; failureCode?: string; deliveryUnknown?: boolean; rendering?: RenderingDiagnostic }>
}
export const DIAGNOSTIC_RETENTION: string
export function validDiagnosticConversation(value: unknown): value is DiagnosticConversation
export function diagnosticConversationKey(value: unknown): string | undefined
export function diagnosticTarget(message: unknown): DiagnosticTarget | { reason: string }
export function conversationDiagnosticTarget(endpoint: unknown, selection: unknown): DiagnosticTarget | { reason: string }
export function diagnosticQuery(target: DiagnosticTarget): string
export function readMessageDiagnostics(body: unknown, target: DiagnosticTarget): MessageDiagnostic[]
export function diagnosticLabel(value?: string): string
export function diagnosticAdvice(record: MessageDiagnostic): string[]
export function createDiagnosticRequestGate(readScope?: () => string | undefined): { begin(): { signal: AbortSignal; current(): boolean }; cancel(): void }
