export const GROUP_PANEL_DRAWER_QUERY: string
export function memberDrawerAvailable(input: { showRightPanel: boolean | null | undefined; narrow: boolean | null | undefined }): boolean
export function memberDrawerOpen(openFor: string | null, groupKey: string | null | undefined, available: boolean): boolean
export function nextMemberDrawerTarget(open: boolean, groupKey: string | null | undefined): string | null
export function shouldResetMemberDrawer(openFor: string | null, groupKey: string | null | undefined, available: boolean): boolean
