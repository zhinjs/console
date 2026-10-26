export function createMutationGate(): { readonly pending: boolean; run(operation: () => Promise<void>): Promise<boolean> }
export function documentTarget(doc: Record<string, unknown> | null, locale?: 'zh-CN' | 'en'): { _id: string | number | boolean }
export function parseDocument(text: string, locale?: 'zh-CN' | 'en'): Record<string, unknown>
export function assertNewKey(key: string, entries: readonly { key: string }[], locale?: 'zh-CN' | 'en'): void
