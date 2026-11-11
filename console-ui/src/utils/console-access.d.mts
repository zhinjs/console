export interface ConsoleAccess {
  readonly unrestricted: boolean
  readonly permissions: ReadonlySet<string>
}
export interface ConsoleAccessReport {
  readonly permissions?: readonly string[] | null
}
export const UNRESTRICTED_ACCESS: ConsoleAccess
export function createConsoleAccess(report: ConsoleAccessReport | null | undefined): ConsoleAccess
export function getConsoleAccess(): ConsoleAccess
export function setConsoleAccess(report: ConsoleAccessReport | null | undefined): void
export function resetConsoleAccess(): void
export function subscribeConsoleAccess(listener: () => void): () => void
export function hasConsolePermission(name: string, access?: ConsoleAccess): boolean
export function hasAnyConsolePermission(names: readonly string[], access?: ConsoleAccess): boolean
