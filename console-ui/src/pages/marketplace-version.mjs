/** Detail metadata is registry dist-tags.latest, not the cached discovery index. */
export function applyRegistryVersion(plugin, detail) {
  if (!detail || detail.name !== plugin.name || !detail.version) return { ...plugin, versionSource: 'index' }
  return { ...plugin, version: detail.version, date: detail.lastPublish || plugin.date, versionSource: 'registry' }
}
export function belongsToZhinScope(name) {
  return typeof name === 'string' && /^@zhin\.js\/[a-z0-9][a-z0-9._-]*$/.test(name)
}
