export function relatedFieldIssue(value: string | undefined, definition?: { type?: string; nullable?: boolean }): string | null
export function relatedRowIssues(columns: string[], draft: Record<string, string>, definitions?: Record<string, { type?: string; nullable?: boolean }>): Record<string, string>
