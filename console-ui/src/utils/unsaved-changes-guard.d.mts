export function setOwnerDirty(owners: ReadonlySet<string>, key: string, dirty: boolean): ReadonlySet<string>
export interface GuardLocation { readonly pathname: string }
export function leavesCurrentPage(currentLocation: GuardLocation | null | undefined, nextLocation: GuardLocation | null | undefined): boolean
export interface GuardBlocker {
  readonly state: 'unblocked' | 'blocked' | 'proceeding'
  proceed?(): void
  reset?(): void
}
export function createBlockedNavigationHandler(confirmLeave: () => boolean | Promise<boolean>): (blocker: GuardBlocker) => void
export interface GuardView {
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}
export function installUnloadGuard(view: GuardView): () => void
