import type { SidebarSelection } from './types'
export interface GroupMembersState<T> { key: string | null; members: T[]; failed?: boolean }
export function groupMembersKey(adapter: string, endpointId: string, selection: SidebarSelection | null | undefined): string | null
export function membersForGroup<T>(state: GroupMembersState<T>, key: string | null): T[]
export function membersPending<T>(state: GroupMembersState<T>, key: string | null): boolean
