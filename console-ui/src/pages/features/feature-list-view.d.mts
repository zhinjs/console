export type FeatureListView = 'list' | 'loading' | 'failed' | 'empty'
/** What the feature list shows: a failed read with no rows is `failed`, never 「还没有功能」. */
export function featureListView(state: { loading: boolean; error: unknown; hasRows: boolean }): FeatureListView
/** A failed `/api/plugins` read as an Error with `details.httpStatus` (and `serverCode` when the Host sent one). */
export function pluginListReadError(status: number, body: { code?: unknown; error?: unknown } | null, t: (text: string, values?: readonly unknown[]) => string, retryAfter?: string | null): Error & { details: { httpStatus: number; serverCode?: string; retryAfter?: number } }
