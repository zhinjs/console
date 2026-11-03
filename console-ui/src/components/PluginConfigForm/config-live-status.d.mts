export type ConfigurationEffect = 'in-place' | 'replace-resource' | 'reconnect-endpoint' | 'reload-plugin' | 'restart-process'
export type ConfigurationGroupStatus = 'applied' | 'restart-pending' | 'blocked' | 'failed' | 'superseded' | 'unknown'
export interface ConfigurationApplication {
  readonly operationId: string
  readonly sourceRevision: string
  readonly saved: boolean
  readonly generation: number
  readonly applicationRevision: number
  readonly groups: readonly Readonly<{
    id: string; paths: readonly (readonly string[])[]; effect: ConfigurationEffect; status: ConfigurationGroupStatus
    reasonCode?: string; dependsOn: readonly string[]
  }>[]
}
export interface ConfigurationApplicationStatus {
  readonly application?: ConfigurationApplication
  readonly applicationError?: 'unconfirmed' | 'superseded' | 'invalid'
}
export interface ConfigurationRuntimeStatus {
  readonly kind: 'unsupported' | 'unknown' | 'stale' | 'applied' | 'partial' | 'pending' | 'failed'
  readonly summary: string
  readonly application?: ConfigurationApplication
  readonly groups: ConfigurationApplication['groups']
}
export function configurationRuntimeStatus(result: unknown, revision: unknown, locale?: 'zh-CN' | 'en'): ConfigurationRuntimeStatus
export function configurationSupportsApply(result: unknown): boolean
export function configurationReceiptForRead<T>(read: { readEpoch?: number }, receipt: { value: T; observedReadEpoch: number } | null): T | null
export function configurationEffectLabel(effect: unknown, locale?: 'zh-CN' | 'en'): string
export function configurationGroupLabel(status: unknown, locale?: 'zh-CN' | 'en'): string
export function configurationPath(path: readonly string[]): string
