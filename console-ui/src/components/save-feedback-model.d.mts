export type SaveButtonPhase = 'idle' | 'saving' | 'saved'
export const SAVED_HOLD_MS: number
export function saveButtonPhase(state: { saving: boolean; saved: boolean }): SaveButtonPhase
