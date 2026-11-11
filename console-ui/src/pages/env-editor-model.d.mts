export interface EnvRow { key: string; value: string; secret: boolean }
export type EnvChange = { type: 'set'; key: string; value: string } | { type: 'delete'; key: string }
export type EnvRowError = 'key-required' | 'key-invalid' | 'key-duplicate' | 'value-masked' | 'value-multiline'
export const ENV_MASK_CHAR: string
export function maskEnvContent(content: string): string
export function isSecretEnvEntry(key: string, value: string): boolean
export function maskEnvValue(value: string): string
export function parseEnvRows(content: string): EnvRow[]
export function updateEnvRow(content: string, key: string, next: { key: string; value: string }): string
export function removeEnvRow(content: string, key: string): string
export function appendEnvRow(content: string, row: { key: string; value: string }): string
export function validateEnvRow(content: string, row: { key: string; value: string }, originalKey: string | null): EnvRowError | null
export function diffEnvContent(original: string, draft: string): EnvChange[]
export function applyEnvChanges(base: string, changes: EnvChange[]): string
export function envEditorAccess(state: { loaded: boolean; readOnly: boolean; saving: boolean; dirty: boolean; editing?: boolean }): { canEdit: boolean; canSave: boolean }
