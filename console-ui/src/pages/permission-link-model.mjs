// Deep links into the command-permission page (/permissions).
// `id` is the exact catalog capability id; `command` is the command name (also used as the
// catalog search text so the command is found even when it is not on the first page);
// `owner` only disambiguates when several commands share a name.

const MAX_NAME = 200, MAX_ID = 8192
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
// Introspection patterns may carry parameter syntax (`echo <text>`); catalog names may not.
export const permissionCommandName = value => {
  const raw = clean(value, MAX_NAME).replace(/\s+/gu, ' ')
  return raw.replace(/\s+[<[].*$/u, '').trim() || raw
}

export function readPermissionLink(params) {
  const get = key => typeof params?.get === 'function' ? params.get(key) : null
  const id = clean(get('id'), MAX_ID), name = permissionCommandName(get('command')), owner = clean(get('owner'), MAX_NAME)
  return id || name ? { id, name, owner } : null
}

export function permissionLinkSearch(command) {
  const params = new URLSearchParams()
  const name = permissionCommandName(command?.name)
  if (name) params.set('command', name)
  const owner = clean(command?.owner, MAX_NAME)
  if (owner) params.set('owner', owner)
  const id = clean(command?.id, MAX_ID)
  if (id) params.set('id', id)
  return params
}

export function permissionLinkFor(name, owner) {
  const search = permissionLinkSearch({ name, owner }).toString()
  return search ? `/permissions?${search}` : '/permissions'
}

export function matchPermissionLink(commands, link) {
  if (!link) return { status: 'none' }
  const list = Array.isArray(commands) ? commands : []
  if (link.id) {
    const exact = list.find(item => item.id === link.id)
    if (exact) return { status: 'matched', command: exact }
  }
  if (!link.name) return { status: 'missing' }
  const named = list.filter(item => permissionCommandName(item.name) === link.name)
  const owned = link.owner ? named.filter(item => item.owner === link.owner) : named
  const candidates = owned.length ? owned : named
  if (candidates.length === 1) return { status: 'matched', command: candidates[0] }
  return { status: candidates.length ? 'ambiguous' : 'missing' }
}

// Never present a failed or not-yet-run read as an empty catalog.
export function permissionCatalogState({ denied, active, loading, error, catalog }) {
  if (denied || !active) return 'unavailable'
  if (loading) return 'loading'
  if (error) return 'error'
  if (catalog) return catalog.commands.length ? 'ready' : 'empty'
  return 'idle'
}
