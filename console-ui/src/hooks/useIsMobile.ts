import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(width < 48rem)'
/**
 * Below this width the top bar cannot hold every section, so navigation moves into a drawer. Not a
 * Console breakpoint: the sections need 1100px (shell.css pairs its `@media (width < 1100px)`).
 */
const COMPACT_NAV_QUERY = '(width < 1100px)'

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

/** Shell navigation switches from the top bar to the drawer at the same width as shell.css. */
export function useIsCompactNav() {
  return useMediaQuery(COMPACT_NAV_QUERY)
}
