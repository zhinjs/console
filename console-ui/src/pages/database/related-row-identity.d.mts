export function relatedPrimaryKeys(definitions?: Record<string, { primary?: boolean }>): string[]
export function relatedRowIdentity(keys: string[], row: Record<string, unknown> | null | undefined): Record<string, unknown>
