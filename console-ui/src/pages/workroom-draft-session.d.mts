export function createWorkroomDraftSessions<T>(): {
  get(connection: object): T | undefined
  set(connection: object, snapshot: T): void
  clear(connection: object): void
  hasUnsaved(connection: object): boolean
}
