export const INTROSPECTION_PAGE_SIZE: number;
export const INTROSPECTION_MAX_PAGES: number;
export interface IntrospectionEnvelope<T> { items: T[]; total: number; page?: number; note?: string }
export function introspectionTotal(envelope: { items?: unknown[]; total?: unknown } | null | undefined): number;
export function fetchAllIntrospection<T>(
  fetchPage: (page: number, pageSize: number) => Promise<IntrospectionEnvelope<T>>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<{ note?: string; items: T[]; total: number; truncated: boolean }>;
export interface BindingModelSource {
  provider?: string
  model?: string
  effective?: { provider?: string; serviceLabel?: string; model?: string; modelLabel?: string; profileLabel?: string } | null
}
export function bindingModel(binding: BindingModelSource | null | undefined): { provider: string; model: string; source: 'effective' | 'configured' | 'default' }
export interface RecentAgentSession { key: string; label: string; turns: number | null; lastAt: number | null; source: 'local' | 'trace'; platform?: string; scopeKind?: string; sceneLabel?: string }
export function recentAgentSessions(
  localKeys: readonly string[],
  traceSessions: ReadonlyArray<{ sessionKey: string; turns?: number; lastAt?: number; label?: string; displayName?: string; name?: string; platform?: string; scopeKind?: string; sceneLabel?: string }> | null | undefined,
  limit?: number,
): RecentAgentSession[]
