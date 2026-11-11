export function confirmErrorMessage(error: unknown): string | null
export function confirmTextMatches(typed: string, expected: string | null | undefined): boolean
export function canSubmitConfirm(state: { loading: boolean; typed: string; confirmText?: string | null }): boolean
