export type DraftField = 'text' | 'extras'
export declare function draftStoreKey(connectionScope: string | null | undefined, adapter: string, endpointId: string): string
export declare function readDraftStore<T = Record<string, unknown>>(key: string, field: DraftField): T | undefined
export declare function writeDraftStore(key: string, field: DraftField, value: Record<string, unknown> | null | undefined): void
export declare function updateDraftStore<T extends Record<string, unknown>>(key: string, field: DraftField, update: (current: T) => T): void
export declare function clearDraftStore(): void
