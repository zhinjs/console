import { translate } from '../../i18n/locale.mjs'
import { outcomeUnknown, statusFromError } from '../../components/status-state-model.mjs'
import { databaseSaveError } from './save-error.mjs'

/**
 * Feedback for a failed KV write (db:kv:set / db:kv:delete), #64 `kv-write-error-raw`.
 * `unknown: true` when the write may have happened anyway: the bucket then blocks every write and
 * offers only 「核对」 (kvCheckResult), never a replay. Otherwise `text` says why in the UI language
 * and `details` keeps the Host's own message for 「技术详情」.
 */
export function kvWriteFailure(error, action, locale = 'zh-CN') {
  const details = error instanceof Error ? error.message : String(error?.message ?? error)
  const status = statusFromError(error)
  if (outcomeUnknown(status)) {
    return { unknown: true, details, text: action === 'delete'
      ? translate(locale, '删除请求已发出，但没有收到可信的答复，键可能已经删除。请先核对，不要直接重试。')
      : translate(locale, '保存请求已发出，但没有收到可信的答复，键值可能已经写入。请先核对，不要直接重试。') }
  }
  if (action !== 'delete') {
    const saved = databaseSaveError(error, locale)
    return { unknown: false, text: saved.text, details: saved.details }
  }
  const text = status.kind === 'forbidden' ? translate(locale, '当前身份没有修改数据库的权限。')
    : status.kind === 'database-busy' ? translate(locale, '数据库正忙，请稍后重试。')
      : status.kind === 'instance-unavailable' ? translate(locale, '实例暂时不可用，请求没有发出，可以稍后重试。')
        : status.kind === 'unsupported' ? translate(locale, '当前 Host 不支持这项数据库操作。')
          : translate(locale, '键没有删除，请检查技术详情后重试。')
  return { unknown: false, text, details }
}

/** Same JSON value whatever the key order (a Host may store objects with their keys re-ordered). */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))

/**
 * 「核对」 for a KV write with an unknown outcome, from the bucket's fresh entries: a save took effect
 * when the key holds the value that was being saved; a delete when the key is gone. A reply without a
 * list cannot decide anything, so it throws and the hold stays.
 */
export function kvCheckResult(entries, plan, locale = 'zh-CN') {
  if (!Array.isArray(entries)) throw new TypeError('The bucket entries are not readable')
  const entry = entries.find(item => item?.key === plan.key)
  if (plan.action === 'delete') {
    return entry
      ? { applied: false, text: translate(locale, '核对结果：键「{0}」仍然存在，删除没有执行，可以重新删除。', [plan.key]) }
      : { applied: true, text: translate(locale, '核对结果：键「{0}」已不存在，删除已经生效。', [plan.key]) }
  }
  if (!entry) return { applied: false, text: translate(locale, '核对结果：键「{0}」不存在，保存没有生效，可以重新保存。', [plan.key]) }
  return same(entry.value, plan.value)
    ? { applied: true, text: translate(locale, '核对结果：键「{0}」已是要保存的值，保存已经生效。', [plan.key]) }
    : { applied: false, text: translate(locale, '核对结果：键「{0}」存在，但值与要保存的不同，保存没有生效。请对照当前值后再决定是否重新保存。', [plan.key]) }
}
