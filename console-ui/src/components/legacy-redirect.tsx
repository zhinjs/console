import { Navigate, useLocation } from 'react-router-dom'
import { resolveLegacyRedirect } from '../console-routes.mjs'

/** Element for an old route: sends the visitor to its new place, keeping the query string. */
export function LegacyRedirect({ fallback = '/dashboard' }: { fallback?: string }) {
  const { pathname, search } = useLocation()
  return <Navigate to={resolveLegacyRedirect(pathname, search) ?? fallback} replace />
}
