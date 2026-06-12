/**
 * 与 @zhin.js/client idb-store 共用同一 IndexedDB（zhin-console / inbox），
 * 供 endpoint-detail 在 RPC 返回前展示缓存的收件箱数据，并在 SSE 推送时增量持久化。
 */

const DB_NAME = 'zhin-console'
const DB_VERSION = 1
const STORE_INBOX = 'inbox'

export type InboxKind = 'message' | 'request' | 'notice'

export interface InboxCacheRecord {
  id: string
  adapter: string
  endpointId?: string
  botId?: string
  kind: InboxKind
  payload: Record<string, unknown>
  updatedAt: number
}

function recordEndpointId(record: InboxCacheRecord): string {
  return String(record.endpointId ?? record.botId ?? '')
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
    }
  })
}

export async function listInboxCache(
  adapter: string,
  endpointId: string,
  kind: InboxKind,
): Promise<InboxCacheRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const all = await new Promise<InboxCacheRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readonly')
      const req = tx.objectStore(STORE_INBOX).getAll()
      req.onsuccess = () => resolve((req.result as InboxCacheRecord[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return all
      .filter((r) => r.adapter === adapter && recordEndpointId(r) === endpointId && r.kind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
  if (typeof indexedDB === 'undefined') return
  try {
    const id = `${adapter}:${endpointId}:${kind}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record: InboxCacheRecord = {
      id,
      adapter,
      endpointId,
      kind,
      payload,
      updatedAt: Date.now(),
    }
    const db = await openDb()
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
