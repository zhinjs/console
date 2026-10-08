export interface FileDraft { content: string; originalContent: string }
export interface FileDraftSession { selected: string | null; drafts: Map<string, FileDraft> }
export function createFileDraftSessions(): {
  get(connection: object): FileDraftSession
  hasUnsaved(connection: object): boolean
}
