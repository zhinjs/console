/**
 * Plugin-registered (in-memory) schedules as the Host reports them in `schedule:list` → `memory`.
 *
 * Optional fields a newer Host adds (zhinjs/zhin#1250 `schedules-page-classification`); every one
 * falls back to what older Hosts send:
 * - `kind`: `'plugin-internal'` for a plugin's own housekeeping (polling, cleanup, flushing);
 *   anything else (or nothing) is a schedule people set up.
 * - `title` (already localized when the request carries `locale`) / `titleI18n` (`{ 'zh-CN'?, en? }`) /
 *   `displayName`: a readable name; else `description`, plugin, id.
 * - `lastExecutedAt` (or `lastRunAt`), `lastStatus` (`succeeded` / `failed`, older `ok` / `error`),
 *   `lastError`; also accepted nested as `lastRun: { at | startedAt, status, error }`.
 */

export const PLUGIN_INTERNAL_KIND = 'plugin-internal'

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : '')
const time = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

export function isPluginInternalSchedule(item) {
  return item?.kind === PLUGIN_INTERNAL_KIND
}

/** Readable name: localized title, title, description, plugin (without `root/`), id. */
export function memoryScheduleTitle(item, locale = 'zh-CN') {
  const localized = item?.titleI18n && typeof item.titleI18n === 'object' ? text(item.titleI18n[locale]) : ''
  return localized || text(item?.title) || text(item?.description) || text(item?.displayName) || text(item?.plugin).replace(/^root\//u, '') || text(item?.id) || text(item?.expression)
}

/** `{ status, at, error }` of the latest run, or null when the Host reports none. */
export function memoryScheduleLastRun(item) {
  const nested = item?.lastRun && typeof item.lastRun === 'object' ? item.lastRun : {}
  const status = text(item?.lastStatus) || text(nested.status)
  const at = time(item?.lastExecutedAt) ?? time(item?.lastRunAt) ?? time(nested.at) ?? time(nested.startedAt)
  const error = text(item?.lastError) || text(nested.error)
  if (!status && at === null && !error) return null
  return { status: status || (error ? 'error' : ''), at, error: error || null }
}
