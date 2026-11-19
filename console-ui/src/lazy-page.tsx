import { lazy, Suspense, type ComponentType } from 'react'
import { StatusState } from './components/StatusState'

/**
 * A route page loaded when it is first opened (#64 `route-code-splitting`): its code — and heavy
 * dependencies such as xterm or highlight.js — stays out of the first screen. The returned component
 * renders like the page itself, so routes keep `element: <XxxPage />`; while the chunk downloads the
 * shared loading state shows, and a chunk that fails to load reaches the page error boundary.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Page = lazy(load)
  function LazyPage() {
    return <Suspense fallback={<StatusState kind="loading" />}><Page /></Suspense>
  }
  return LazyPage
}
