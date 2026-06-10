/**
 * 与 @zhin.js/client idb-store 共用同一 IndexedDB（zhin-console / inbox），
 * 供 bot-detail 在 RPC 返回前展示缓存的收件箱数据。
 */

const DB_NAME = 'zhin-console'
const DB_VERSION = 1
const STORE_INBOX = 'inbox'

export type InboxKind = 'message' | 'request' | 'notice'

export interface InboxCacheRecord {
  id: string
  adapter: string
  botId: string
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
    }
  })
}

export async function listInboxCache(
  adapter: string,
  botId: string,
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
      .filter((r) => r.adapter === adapter && r.botId === botId && r.kind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}
