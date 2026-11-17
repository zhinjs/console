import { translate } from '../../i18n/locale.mjs'
import { outcomeUnknown, statusFromError } from '../../components/status-state-model.mjs'

/**
 * Feedback for a failed database write (db:insert / db:update / db:delete).
 * `type: 'unknown'` when the request may have been applied anyway (timeout, instance_timeout with
 * requestOutcome 'unknown', a dropped connection): the page then blocks the write and offers only
 * 「核对」 (a db:select), never a replay (#64 database-insert-unknown-outcome).
 */
export function databaseSaveError(error, locale = 'zh-CN') {
 const details = error instanceof Error ? error.message : String(error?.message ?? error)
 const status = statusFromError(error)
 if (outcomeUnknown(status)) return { type: 'unknown', text: translate(locale, "结果未知：请求已发出，但没有收到可信的答复，可能已经写入。请先核对，不要直接重试。"), details }
 const duplicate = /unique constraint|duplicate key|duplicate entry/i.test(details)
 if (duplicate) return { type: 'error', text: translate(locale, "主键或唯一字段已存在，请修改后重试。"), details }
 const text = status.kind === 'forbidden' ? "当前身份没有修改数据库的权限。"
  : status.kind === 'database-busy' ? "数据库正忙，当前输入已保留。请稍后重试。"
   : status.kind === 'instance-unavailable' ? "实例暂时不可用，请求没有发出。当前输入已保留，可以稍后重试。"
    : status.kind === 'unsupported' ? "当前 Host 不支持这项数据库操作。"
     : "保存失败，当前输入已保留。请检查详情后重试。"
 return { type: 'error', text: translate(locale, text), details }
}
