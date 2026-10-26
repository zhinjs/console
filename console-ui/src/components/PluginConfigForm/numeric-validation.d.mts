import type { SchemaField } from './types.js'
export function numericFieldIssue(field: SchemaField, value: unknown, locale?: 'zh-CN' | 'en'): string | null
export function numericConfigInvalid(fields: Record<string, SchemaField>, config: unknown, locale?: 'zh-CN' | 'en'): boolean
