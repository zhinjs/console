/** Permission the Host requires for a Console HTTP request: a name, '' for any signed-in identity, null when denied. */
export function httpRoutePermission(method: string, relativePath: string): string | null
/** Whether the current identity may send the request, and the permission it lacks (null when none / denied for all). */
export function httpRouteAccess(method: string, relativePath: string, has: (permission: string) => boolean): { allowed: boolean; missing: string | null }
