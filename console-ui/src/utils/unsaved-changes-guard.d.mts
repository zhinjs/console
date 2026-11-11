export function setOwnerDirty(owners: ReadonlySet<string>, key: string, dirty: boolean): ReadonlySet<string>
export interface GuardedAnchor { href: string; target?: string | null; download?: boolean }
export interface GuardedClick { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
export function guardedNavigationTarget(anchor: GuardedAnchor | null | undefined, click: GuardedClick, current: { href: string }): string | null
export interface GuardView {
  readonly location: { readonly href: string }
  addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
}
export function installUnsavedChangesGuard(options: { view: GuardView; confirmLeave: () => boolean | Promise<boolean>; navigate: (path: string) => void }): () => void
