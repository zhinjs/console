/**
 * Unsent composer state of each account, kept in memory for the life of the page. The 聊天 tab is
 * unmounted when another tab opens (only the open tab is mounted), so text, attachments and quotes
 * would otherwise vanish on a tab switch. Nothing is written to browser storage: a refresh still
 * asks first (beforeunload) while anything is unsent.
 *
 * Keys combine the connection scope with the account, so a draft never shows up under another Host
 * or account; inside one account, drafts are kept per conversation by their caller.
 */
const store = new Map()

export function draftStoreKey(connectionScope, adapter, endpointId) {
  return JSON.stringify([connectionScope ?? '', adapter ?? '', endpointId ?? ''])
}

const isEmpty = value => value == null || (typeof value === 'object' && Object.keys(value).length === 0)

/** Stored drafts of one field (`text` / `extras`): a `{ [conversationKey]: value }` record, or undefined. */
export function readDraftStore(key, field) {
  return store.get(key)?.[field]
}

export function writeDraftStore(key, field, value) {
  const entry = { ...store.get(key) }
  if (isEmpty(value)) delete entry[field]
  else entry[field] = value
  if (Object.keys(entry).length) store.set(key, entry)
  else store.delete(key)
}

/** Read-modify-write; used when a send finishes after its workspace has been unmounted. */
export function updateDraftStore(key, field, update) {
  writeDraftStore(key, field, update(readDraftStore(key, field) ?? {}))
}

/** For tests. */
export function clearDraftStore() {
  store.clear()
}
