export type ConfigErrorState = {readError: string | null; saveError: string | null; readDenied?: boolean};
export type ConfigErrorAction = {type: 'read-start' | 'save-start' | 'save-succeeded' | 'discard-save'} | {type: 'read-failed'; error: string; denied?: boolean} | {type: 'save-failed'; error: string};
export function configErrorReducer(state: ConfigErrorState, action: ConfigErrorAction): ConfigErrorState;
export function isReadDenied(cause: unknown): boolean;
