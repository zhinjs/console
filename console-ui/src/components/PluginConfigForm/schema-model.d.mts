import type { SchemaField } from './types.js'
export function objectFields(schema: unknown): Record<string, SchemaField>
export function unsupportedFormFields(schema: unknown, path?: string): string[]
export function declaredDefaults(schema: SchemaField, value: unknown): any
export function initialSchemaValue(schema: SchemaField): unknown
export function matchingSchemaBranches(branches: SchemaField[], value: unknown): number[]
export function updateObjectField(value: unknown, key: string, child: unknown): Record<string, any>
export function updateListItem(value: unknown[], index: number, child: unknown): unknown[]
export function numericDraft(text: string): string | number | undefined
export function requiredGuidance(schema: SchemaField, value: unknown, path?: string): string[]
export function hostValidationSummary(checked: { valid: boolean; missingEnv?: readonly string[] } | null): string | null
