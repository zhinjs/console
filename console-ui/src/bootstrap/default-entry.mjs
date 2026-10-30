/** Resolve from this Host's registered pages, after its entries have loaded. */
export function resolveConsoleEntry(routes) {
  return routes.some(route => route.path === '/sandbox') ? '/sandbox' : '/dashboard'
}
