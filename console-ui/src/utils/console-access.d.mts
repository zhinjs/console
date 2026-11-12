export interface ConsoleScopedBinding {
  readonly kind: 'adapter' | 'endpoint'
  /** `<adapter>` or `<adapter>/<endpoint>`. */
  readonly key: string
  readonly permissions: ReadonlySet<string>
}
export interface ConsoleAccess {
  readonly unrestricted: boolean
  /** Held through global bindings. */
  readonly permissions: ReadonlySet<string>
  /** Adapter / endpoint bindings (scoped permissions only). */
  readonly scoped?: readonly ConsoleScopedBinding[]
}
export interface ConsoleAccessReport {
  readonly permissions?: readonly string[] | null
  readonly bindings?: readonly unknown[] | null
}
export type ConsolePermissionTarget =
  | { readonly kind: 'global' }
  | { readonly kind: 'any' }
  | { readonly kind: 'adapter'; readonly adapter: string }
  | { readonly kind: 'endpoint'; readonly adapter: string; readonly endpoint: string }
export const UNRESTRICTED_ACCESS: ConsoleAccess
export const GLOBAL_TARGET: ConsolePermissionTarget
export const ANY_TARGET: ConsolePermissionTarget
export function createConsoleAccess(report: ConsoleAccessReport | null | undefined): ConsoleAccess
export function scopePermissionTarget(scope: { readonly adapter?: string | null; readonly endpoint?: string | null } | null | undefined): ConsolePermissionTarget
export function getConsoleAccess(): ConsoleAccess
export function setConsoleAccess(report: ConsoleAccessReport | null | undefined): void
export function resetConsoleAccess(): void
export function subscribeConsoleAccess(listener: () => void): () => void
export function hasConsolePermission(name: string, access?: ConsoleAccess, target?: ConsolePermissionTarget): boolean
export function hasAnyConsolePermission(names: readonly string[], access?: ConsoleAccess, target?: ConsolePermissionTarget): boolean
