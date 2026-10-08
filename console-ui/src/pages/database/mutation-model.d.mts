export function createMutationGate(): { readonly pending: boolean; run(operation: () => Promise<void>): Promise<boolean> }
export function documentTarget(doc: Record<string, unknown> | null): { _id: string | number | boolean }
export function parseDocument(text: string): Record<string, unknown>
export function assertNewKey(key: string, entries: readonly { key: string }[]): void
