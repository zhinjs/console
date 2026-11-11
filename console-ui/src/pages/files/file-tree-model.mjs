// Pure helpers for the project file tree. The Host `files:tree` RPC returns one
// depth-limited snapshot (no per-directory listing or search RPC), so every answer
// here is about that loaded snapshot only.

/** Normalize a deep-link path the same way Host relative paths are written. */
export function normalizeTreePath(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '').split('/').filter(Boolean).join('/')
}

/**
 * Locate a file path in the loaded tree.
 * - found: the file node exists; `ancestors` are the directories to expand.
 * - directory: the path names a directory, not a file.
 * - beyond-tree: the deepest known ancestor has no listed children, which is also
 *   how the Host marks directories past its depth limit, so existence is unknown.
 * - missing: an ancestor listing is present and does not contain the path.
 */
export function locateTreePath(tree, path) {
  const segments = normalizeTreePath(path).split('/').filter(Boolean)
  const ancestors = []
  let level = Array.isArray(tree) ? tree : []
  let parent = null
  for (let index = 0; index < segments.length; index++) {
    const current = segments.slice(0, index + 1).join('/')
    const node = level.find(item => item.path === current)
    if (!node) {
      const status = parent && !(parent.children?.length) ? 'beyond-tree' : 'missing'
      return { status, ancestors }
    }
    if (index === segments.length - 1) {
      return node.type === 'directory' ? { status: 'directory', ancestors: [...ancestors, node.path] } : { status: 'found', ancestors }
    }
    if (node.type !== 'directory') return { status: 'missing', ancestors }
    ancestors.push(node.path)
    parent = node
    level = node.children ?? []
  }
  return { status: 'missing', ancestors }
}

/** Case-insensitive file-name search over the loaded snapshot, in tree order. */
export function searchTreeFiles(tree, query, limit = 200) {
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  const matches = []
  let total = 0
  if (!needle) return { matches, total }
  const visit = nodes => {
    for (const node of nodes ?? []) {
      if (node.type === 'directory') visit(node.children)
      else if (node.name.toLocaleLowerCase().includes(needle)) {
        total += 1
        if (matches.length < limit) matches.push(node)
      }
    }
  }
  visit(tree)
  return { matches, total }
}
