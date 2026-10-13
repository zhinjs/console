import { getApiBase, getToken } from './auth'
import { createInboxCacheAuthority, selectInboxCache } from './inbox-cache-scope.mjs'

/**
 * SDK-shared IndexedDB, but this UI reads only its current authenticated connection scope.
 * The opaque random scope persists with records; no credential/hash is written or returned.
 * A page reload creates a fresh identity, so prior-session and unscoped SDK rows are not hydrated.
 */
const authority = createInboxCacheAuthority(() => {
  try { return { host: getApiBase(), credential: getToken() ?? undefined } }
  catch { return undefined }
})
export function getInboxCacheScope(): string | undefined { return authority.current() }
export function isInboxCacheScopeActive(scope?: string): boolean { return authority.active(scope) }

const DB_NAME = 'zhin-console'
const DB_VERSION = 2
const STORE_INBOX = 'inbox'
const STORE_PENDING = 'pending'

export type InboxKind = 'message' | 'request' | 'notice'

export interface InboxCacheRecord {
  id: string
  adapter: string
  scope?: string
  endpoint_id?: string
  kind: InboxKind
  payload: Record<string, unknown>
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_INBOX)) {
        db.createObjectStore(STORE_INBOX, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id' })
      }
    }
  })
}

export async function listInboxCache(
  adapter: string,
  endpointId: string,
  kind: InboxKind,
): Promise<InboxCacheRecord[]> {
  const scope = authority.current()
  if (!scope || typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const all = await new Promise<InboxCacheRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readonly')
      const req = tx.objectStore(STORE_INBOX).getAll()
      req.onsuccess = () => resolve((req.result as InboxCacheRecord[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return authority.active(scope) ? selectInboxCache(all, scope, adapter, endpointId, kind) : []
  } catch {
    return []
  }
}

export async function putInboxCache(
  adapter: string,
  endpointId: string,
  kind: InboxKind,
  payload: Record<string, unknown>,
): Promise<void> {
  const scope = authority.current()
  if (!scope || typeof indexedDB === 'undefined') return
  try {
    const id = `${adapter}:${endpointId}:${kind}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record: InboxCacheRecord = {
      id,
      scope,
      adapter,
      endpoint_id: endpointId,
      kind,
      payload,
      updatedAt: Date.now(),
    }
    const db = await openDb()
    if (!authority.active(scope)) { db.close(); return }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite')
      tx.objectStore(STORE_INBOX).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // 缓存失败不影响主流程
  }
}
