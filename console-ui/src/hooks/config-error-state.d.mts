export type ConfigErrorState = {readError: string | null; saveError: string | null};
export type ConfigErrorAction = {type: 'read-start' | 'save-start' | 'save-succeeded' | 'discard-save'} | {type: 'read-failed' | 'save-failed'; error: string};
export function configErrorReducer(state: ConfigErrorState, action: ConfigErrorAction): ConfigErrorState;
