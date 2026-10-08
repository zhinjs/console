/** Preserve both the draft and its publication base, scoped to one Host client. */
export function createWorkroomDraftSessions() {
  const sessions = new WeakMap()
  return {
    get(connection) { return sessions.get(connection) },
    set(connection, snapshot) { sessions.set(connection, structuredClone(snapshot)) },
    clear(connection) { sessions.delete(connection) },
    hasUnsaved(connection) { return sessions.has(connection) },
  }
}
