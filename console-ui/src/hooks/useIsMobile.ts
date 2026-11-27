import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(width < 48rem)'
/**
 * Phones (the Console's md breakpoint, 48rem): the section NavPill / NavIcons leave the top bar for
 * the floating TabBar, and 「更多」 opens the drawer with every page (shell.css pairs its
 * `@media (width < 48rem)`). The round section icons fit the top bar from 48rem up.
 */
const COMPACT_NAV_QUERY = '(width < 48rem)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Match the shared CSS breakpoint for conversation drawers and phone layouts. */
export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY)
}

/** Shell navigation switches from the top bar to the TabBar + drawer at the same width as shell.css. */
export function useIsCompactNav() {
  return useMediaQuery(COMPACT_NAV_QUERY)
}
