import { lazy, Suspense, type ComponentType } from 'react'
import { StatusState } from './components/StatusState'

/**
 * A route page loaded when it is first opened (#64 `route-code-splitting`, `route-code-splitting-rest`):
 * its code — and heavy dependencies such as xterm or highlight.js — stays out of the first screen. The
 * returned component renders like the page itself (props are passed on), so routes keep
 * `element: <XxxPage />`; while the chunk downloads the shared loading state shows, and a chunk that
 * fails to load reaches the page error boundary.
 */
export function lazyPage<P extends object = Record<string, never>>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  // React.lazy keeps a failed load (a network blip, or chunks replaced by a deploy while the tab was
  // open): a fresh lazy component then lets 「重试当前页面」 load the page again instead of failing again.
  const create = () => lazy(() => load().catch((error: unknown) => { Page = create(); throw error }))
  let Page = create()
  function LazyPage(props: P) {
    return <Suspense fallback={<StatusState kind="loading" />}><Page {...props} /></Suspense>
  }
  return LazyPage
}
