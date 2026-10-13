/** Only the currently authenticated UI connection owns this opaque session namespace. */
export function createInboxCacheAuthority(readConnection, newId = () => crypto.randomUUID()) {
  let host, credential, scope
  return {
    current() {
      const connection = readConnection()
      const nextHost = connection?.host?.trim().replace(/\/$/u, '')
      const nextCredential = connection?.credential?.trim()
      if (!nextHost || !nextCredential) { host = credential = scope = undefined; return undefined }
      if (host !== nextHost || credential !== nextCredential) {
        host = nextHost; credential = nextCredential; scope = newId()
      }
      return scope
    },
    active(expected) { return Boolean(expected) && this.current() === expected },
  }
}
export function selectInboxCache(records, scope, adapter, endpointId, kind) {
  if (!scope) return []
  return records.filter(record => record.scope === scope && record.adapter === adapter && record.endpoint_id === endpointId && record.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500)
}
