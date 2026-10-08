/** Drafts stay in memory and cannot cross Host client identities. */
export function createFileDraftSessions() {
  const sessions = new WeakMap()
  return {
    get(connection) {
      let session = sessions.get(connection)
      if (!session) {
        session = { selected: null, drafts: new Map() }
        sessions.set(connection, session)
      }
      return session
    },
    hasUnsaved(connection) { return Boolean(sessions.get(connection)?.drafts.size) },
  }
}
