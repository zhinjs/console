export function maskEnvContent(content: string): string
export function envEditorAccess(state: { loaded: boolean; readOnly: boolean; saving: boolean; masked: boolean; dirty: boolean }): { canEdit: boolean; canSave: boolean }
