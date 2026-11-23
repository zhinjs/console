export interface DdlFailure { readonly unknown: boolean; readonly text: string; readonly details: string }
/** A failed db:drop-table / db:schema:apply: `unknown` means it may have run (offer only 「核对」). */
export function ddlFailure(error: unknown, action: 'drop' | 'schema', locale?: string): DdlFailure
export interface DdlCheckResult { readonly applied: boolean | null; readonly text: string }
/** Throws when `tables` is not a list: an undecidable check keeps the hold. */
export function dropCheckResult(tables: readonly { readonly name?: string }[] | null | undefined, name: string, locale?: string): DdlCheckResult
export function createCheckResult(tables: readonly { readonly name?: string }[] | null | undefined, name: string, locale?: string): DdlCheckResult
export function alterCheckResult(locale?: string): DdlCheckResult
