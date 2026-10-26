import type { MessageDiagnostic } from './message-diagnostics.mjs'
export interface DiagnosticHelpLink { id: string; label: string; href: string }
export function diagnosticHelpLinks(record: MessageDiagnostic, locale?: 'zh-CN' | 'en'): DiagnosticHelpLink[]
