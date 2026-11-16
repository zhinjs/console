/**
 * Plugin pages as tabs of the plugin detail page (ADR 0063 决策 3, ADR 0062 第 24 项).
 *
 * A page a plugin contributes is mounted at `/plugins/<plugin>/<page>`, a concrete path (never
 * `:param`, which the command palette cannot open), and shown as a tab next to the plugin's
 * 概览. Its old top-level path (`/rss`) becomes a redirect. An adapter's connection page is
 * already embedded in the adapter object page (`/scope/<adapter>`), so its old path redirects
 * there instead of becoming a second entry. Pure data and string helpers: route records are
 * built in `navigation-taxonomy.ts`, elements in `bootstrap/loadConsoleEntries.ts`.
 */
import { CONSOLE_PATHS, adapterHref } from './console-routes.mjs'

/** A page's local name (`@zhin.js/console-contract` `assertPageLocalName`). */
const LOCAL_NAME = /^[a-z0-9][a-z0-9-]*$/u
/** The owner of pages declared by the project itself rather than by a plugin. */
const ROOT_OWNER = 'root'
export const PLUGIN_OVERVIEW_TAB = 'overview'

const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined

/**
 * The plugin name a page belongs to, as `/plugins/:name` expects it (the instance key).
 * `root/rss` → `rss`, `root/group/rss` → `rss`; `root` (the project's own pages) → null.
 */
export function pluginNameFromOwner(owner) {
  const value = text(owner)
  if (!value) return null
  const parts = value.split('/').filter(Boolean)
  if (parts[0] === ROOT_OWNER) parts.shift()
  return parts.length ? parts[parts.length - 1] : null
}

/** Path segments of a route path; `null` for anything that is not an absolute path. */
function segments(path) {
  return typeof path === 'string' && path.startsWith('/') ? path.split('/').filter(Boolean) : null
}

/**
 * Plugin and page names of a page route. The Host mounts a plugin's `pages/index` at `/<plugin>`
 * and `pages/<name>` at `/<plugin>/p-<name>`; the project's own pages sit at `/p-<name>`.
 */
export function pluginPageIdentity(route, owner) {
  const parts = segments(route)
  if (!parts || !parts.length) return null
  const ownerGiven = owner !== undefined && owner !== null && owner !== ''
  const plugin = ownerGiven ? pluginNameFromOwner(owner) : (parts[0].startsWith('p-') ? null : parts[0])
  if (!plugin) return null
  const last = parts[parts.length - 1]
  if (last.startsWith('p-') && LOCAL_NAME.test(last.slice(2))) return { plugin, page: last.slice(2) }
  // A Host page path without `p-` is the plugin's index page (`/rss`, nested `/group/rss`); a
  // hand-registered `/<plugin>/<name>` without an owner keeps its last segment as the page name.
  if (ownerGiven || parts.length === 1 || !LOCAL_NAME.test(last)) return { plugin, page: 'index' }
  return { plugin, page: last }
}

const segment = value => encodeURIComponent(String(value))

/** `/plugins/<plugin>/<page>` — a tab of the plugin detail page. */
export function pluginPagePath(plugin, page) {
  return `/plugins/${segment(plugin)}/${segment(page)}`
}

/** `/plugins/<plugin>` — the plugin detail page itself (its 概览 tab). */
export function pluginDetailPath(plugin) {
  return `${CONSOLE_PATHS.plugins}/${segment(plugin)}`
}

/**
 * Search aliases a page declares (`definePage({ keywords })`): `string[]`, or per language
 * `{ 'zh-CN': string[], en: string[] }`. Every language is kept, like the builtin search hints, so
 * an alias finds its page whichever language the Console shows. Anything else is ignored.
 */
export function normalizePageKeywords(...values) {
  const out = []
  const push = value => {
    const word = text(value)
    if (word && !out.includes(word)) out.push(word)
  }
  const visit = (value, depth) => {
    if (typeof value === 'string') push(value)
    else if (Array.isArray(value)) { if (depth < 2) for (const item of value) visit(item, depth + 1) }
    else if (value && typeof value === 'object' && depth < 1) { for (const item of Object.values(value)) visit(item, depth + 1) }
  }
  for (const value of values) visit(value, 0)
  return out
}

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/**
 * What the Console knows about one page from `/entries`: where it was, where it goes, and what the
 * command palette searches. Fields the Host does not send yet (`keywords`, `packageName`) are read
 * defensively from the entry, its `meta` and its `metadata`. Null when the entry has no route.
 */
export function describePluginPage(entry) {
  const raw = objectOf(entry)
  const meta = objectOf(raw.meta)
  const metadata = objectOf(raw.metadata)
  const legacyPath = text(raw.route) ?? (text(raw.id) ? `/${text(raw.id)}` : undefined)
  if (!legacyPath || !legacyPath.startsWith('/')) return null
  const identity = pluginPageIdentity(legacyPath, raw.owner)
  const blueprint = objectOf(raw.blueprint)
  const adapterKey = blueprint.kind === 'zhin.console.adapter-page' ? text(blueprint.adapterKey) ?? identity?.plugin : undefined
  const section = text(raw.section) ?? text(meta.section) ?? text(metadata.section)
  return {
    legacyPath,
    plugin: identity?.plugin ?? null,
    page: identity?.page ?? null,
    keywords: normalizePageKeywords(raw.keywords, meta.keywords, metadata.keywords),
    ...(section ? { section } : {}),
    ...(text(raw.description) ?? text(meta.description) ? { description: text(raw.description) ?? text(meta.description) } : {}),
    ...(text(raw.packageName) ?? text(objectOf(raw.plugin).packageName) ? { packageName: text(raw.packageName) ?? text(objectOf(raw.plugin).packageName) } : {}),
    ...(text(raw.pluginDescription) ?? text(objectOf(raw.plugin).description) ? { pluginDescription: text(raw.pluginDescription) ?? text(objectOf(raw.plugin).description) } : {}),
    ...(adapterKey ? { adapterKey } : {}),
  }
}

/** Where an adapter's old page now lives: the connection management of its object page. */
export function adapterPageHref(adapterKey) {
  return adapterHref(adapterKey)
}

/**
 * Visible tabs of one plugin, in order: its `index` page first, then by `meta.order`, then as
 * registered. `names` are the identifiers the detail page knows the plugin by (route name,
 * instance key, package name). Pages that hide themselves from navigation stay reachable by path
 * and in the command palette, but get no tab.
 */
export function pluginTabsOf(routes, names) {
  const wanted = new Set((Array.isArray(names) ? names : [names]).filter(name => typeof name === 'string' && name))
  const tabs = []
  for (const [index, route] of (routes ?? []).entries()) {
    const tab = route?.meta?.pluginTab
    if (!tab || tab.kind !== 'tab' || tab.hidden || !wanted.has(tab.plugin)) continue
    tabs.push({ route, tab, index })
  }
  const rank = entry => entry.tab.page === 'index' ? -Infinity : typeof entry.route.meta?.order === 'number' ? entry.route.meta.order : 999
  return tabs.sort((a, b) => rank(a) - rank(b) || a.index - b.index).map(entry => entry.route)
}

/** Plugin directory from `/api/plugins` (instance key / name → package name and description). */
let directory = Object.freeze({})
const listeners = new Set()

/** Accepts the `/api/plugins` body (`{ data: [...] }`) or a bare list; malformed items are skipped. */
export function readPluginDirectory(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  const out = {}
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const info = Object.freeze({
      ...(text(item.name) ? { name: text(item.name) } : {}),
      ...(text(item.packageName) ? { packageName: text(item.packageName) } : {}),
      ...(text(item.description) ? { description: text(item.description) } : {}),
    })
    for (const key of [text(item.instanceKey), text(item.name)]) if (key && !Object.hasOwn(out, key)) out[key] = info
  }
  return Object.freeze(out)
}

export function setPluginDirectory(next) {
  directory = next && typeof next === 'object' ? next : Object.freeze({})
  for (const listener of listeners) listener()
}

export function pluginDirectory() {
  return directory
}

export function subscribePluginDirectory(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const warnedSections = new Set()

/**
 * A plugin page that still declares `metadata.section` is a plugin detail tab like any other
 * (ADR 0063 D6: `section` is deprecated). Warns once per page path.
 */
export function warnIgnoredSection(path, section, logger = console) {
  if (!section || warnedSections.has(path)) return false
  warnedSections.add(path)
  logger.warn(`[zhin-console] Plugin page ${path} declares section "${section}". Plugin pages are tabs of their plugin's detail page now (ADR 0063), so the section is ignored; remove it from definePage().`)
  return true
}

/** For tests: forget which pages were already warned about. */
export function resetIgnoredSectionWarnings() {
  warnedSections.clear()
}
