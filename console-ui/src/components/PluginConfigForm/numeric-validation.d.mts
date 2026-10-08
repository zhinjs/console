import type { SchemaField } from './types.js'
export function numericFieldIssue(field: SchemaField, value: unknown): string | null
export function numericConfigInvalid(fields: Record<string, SchemaField>, config: unknown): boolean
