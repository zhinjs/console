import { translate } from '../i18n/locale.mjs'

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turns the runtime Workroom Catalog into the board's project picker list.
 * A malformed Catalog is a read failure, never "no projects configured".
 */
export function projectsFromCatalog(catalog, locale = 'zh-CN') {
  if (!isRecord(catalog) || (catalog.workrooms !== undefined && !isRecord(catalog.workrooms))) {
    throw new Error(translate(locale, "Workroom 项目目录格式无效"))
  }
  return Object.entries(catalog.workrooms ?? {}).map(([id, room]) => {
    const value = isRecord(room) ? room : {}
    return {
      id,
      name: typeof value.name === 'string' && value.name ? value.name : id,
      description: typeof value.description === 'string' ? value.description : undefined,
      enabled: value.enabled !== false,
    }
  })
}

/** One view state at a time: an error never renders alongside the empty state. */
export function projectListView(projects, error) {
  if (error) return 'error'
  if (projects === null) return 'loading'
  return projects.length ? 'ready' : 'empty'
}
