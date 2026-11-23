export interface KvWriteFailure { readonly unknown: boolean; readonly text: string; readonly details: string }
/** A failed db:kv:set / db:kv:delete: `unknown` means it may have happened (offer only 「核对」). */
export function kvWriteFailure(error: unknown, action: 'set' | 'delete', locale?: string): KvWriteFailure
export type KvWritePlan = { readonly action: 'set'; readonly key: string; readonly value: unknown } | { readonly action: 'delete'; readonly key: string }
/** Throws when `entries` is not a list: an undecidable check keeps the hold. */
export function kvCheckResult(entries: readonly { readonly key: string; readonly value?: unknown }[] | null | undefined, plan: KvWritePlan, locale?: string): { readonly applied: boolean; readonly text: string }
