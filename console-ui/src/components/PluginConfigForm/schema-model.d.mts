import type { SchemaField } from './types.js'
export function objectFields(schema: unknown): Record<string, SchemaField>
export function unsupportedFormFields(schema: unknown, path?: string, locale?: 'zh-CN' | 'en'): string[]
export function declaredDefaults(schema: SchemaField, value: unknown): any
export function initialSchemaValue(schema: SchemaField): unknown
export function matchingSchemaBranches(branches: SchemaField[], value: unknown): number[]
export function updateObjectField(value: unknown, key: string, child: unknown): Record<string, any>
export function updateListItem(value: unknown[], index: number, child: unknown): unknown[]
export function numericDraft(text: string): string | number | undefined
export function requiredGuidance(schema: SchemaField, value: unknown, path?: string): string[]
export function hostValidationSummary(checked: { valid: boolean; missingEnv?: readonly string[] } | null, locale?: 'zh-CN' | 'en'): string | null
export function configFieldGroup(field: SchemaField | undefined): string | null
export function isWideConfigField(field: SchemaField | undefined): boolean
export function configFieldLayout<T extends readonly [string, SchemaField]>(entries: readonly T[]): { title: string | null; fields: T[] }[]
export function isMillisecondField(name: string | undefined, field: SchemaField | undefined): boolean
export function secondsText(value: unknown): string
export function millisecondsFromSecondsText(text: string): string | number | undefined
