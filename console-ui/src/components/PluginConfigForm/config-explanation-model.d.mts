export type ExplanationBinding = { scope: string; instanceKey: string; revision: string; disabled?: boolean }
export type ConfigExplanation = { instanceKey: string; revision: string; projectRevision: string; generation: number | null; projection: 'supported' | 'unsupported'; reason?: string; fields: { path: string[]; candidateOrigin: 'file' | 'schema-default' | 'unset' | 'unknown'; generationMatch: 'equal' | 'different' | 'redacted' | 'unknown'; generationOrigin: 'unknown' }[] }
export type ExplanationState = { kind: 'idle' | 'loading' | 'error' | 'ready'; key: string | null; data?: ConfigExplanation; message?: string }
export const CONFIG_EXPLANATION_REASONS: Readonly<Record<string, string>>
export const CONFIG_CANDIDATE_ORIGINS: Readonly<Record<string, string>>
export const CONFIG_GENERATION_MATCHES: Readonly<Record<string, string>>
export function validExplanationBinding(value: unknown): boolean
export function explanationBindingKey(binding: unknown): string | null
export function readConfigExplanation(value: unknown, expected?: Pick<ExplanationBinding, 'instanceKey' | 'revision'>, locale?: 'zh-CN' | 'en'): ConfigExplanation
export function createConfigExplanationReader(options: { read: (binding: {instanceKey: string; revision: string}) => Promise<unknown>; getBinding: () => ExplanationBinding; active: (scope: string) => boolean; publish: (state: ExplanationState) => void }, locale?: 'zh-CN' | 'en'): { load(): Promise<void>; cancel(): void }
