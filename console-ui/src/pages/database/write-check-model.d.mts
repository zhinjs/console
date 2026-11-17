export type WriteKind = 'insert' | 'update' | 'delete'
export interface WriteCheckPlan { kind: WriteKind; where: Record<string, unknown> | null; row?: Record<string, unknown> }
export type WriteCheckVerdict = 'applied' | 'not-applied' | 'undetermined'
export function insertCheckWhere(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null
export function writeCheckPlan(kind: WriteKind, input?: { row?: Record<string, unknown>; where?: Record<string, unknown> }): WriteCheckPlan
export function runWriteCheck(plan: WriteCheckPlan, select: (where: Record<string, unknown>) => Promise<{ rows?: unknown[]; total?: number }>, definitions?: Record<string, { type?: string }>): Promise<{ verdict: WriteCheckVerdict; count?: number }>
export function writeCheckCopy(kind: WriteKind, verdict: WriteCheckVerdict): string
