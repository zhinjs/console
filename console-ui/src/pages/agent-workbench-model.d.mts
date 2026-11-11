export const INTROSPECTION_PAGE_SIZE: number;
export const INTROSPECTION_MAX_PAGES: number;
export interface IntrospectionEnvelope<T> { items: T[]; total: number; page?: number; note?: string }
export function introspectionTotal(envelope: { items?: unknown[]; total?: unknown } | null | undefined): number;
export function fetchAllIntrospection<T>(
  fetchPage: (page: number, pageSize: number) => Promise<IntrospectionEnvelope<T>>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<{ note?: string; items: T[]; total: number; truncated: boolean }>;
