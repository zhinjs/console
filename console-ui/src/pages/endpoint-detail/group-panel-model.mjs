/**
 * Narrow workspaces have no room for the fixed group-member column (`.im-right-panel` is only shown
 * at `min-width: 900px` in im-workspace.css). This query is its exact complement, so at every width
 * exactly one of the column or the header drawer entry is available.
 */
export const GROUP_PANEL_DRAWER_QUERY = 'not all and (min-width: 900px)'

/** The header entry exists only where the member column would exist but cannot be shown. */
export function memberDrawerAvailable({ showRightPanel, narrow }) {
  return Boolean(showRightPanel) && Boolean(narrow)
}

/**
 * The drawer remembers which group it was opened for. Selecting another conversation (or widening
 * the window so the column returns) closes it without any effect or extra state reset.
 */
export function memberDrawerOpen(openFor, groupKey, available) {
  return Boolean(available) && groupKey != null && openFor === groupKey
}

/** Next `openFor` value after the drawer's open state changes for `groupKey`. */
export function nextMemberDrawerTarget(open, groupKey) {
  return open && groupKey != null ? groupKey : null
}

/**
 * The remembered target is dropped as soon as it no longer matches, so returning to the same group
 * (or narrowing the window again) never reopens a drawer the user did not open.
 */
export function shouldResetMemberDrawer(openFor, groupKey, available) {
  return openFor !== null && !memberDrawerOpen(openFor, groupKey, available)
}
