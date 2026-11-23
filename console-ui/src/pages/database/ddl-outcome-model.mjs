import { translate } from '../../i18n/locale.mjs'
import { outcomeUnknown, statusFromError } from '../../components/status-state-model.mjs'

/**
 * Feedback for a failed DDL (db:drop-table / db:schema:apply), #64 `database-ddl-unknown-outcome`.
 * `unknown: true` when the statement may have run anyway (a timeout, instance_timeout with
 * requestOutcome 'unknown', a dropped connection): the page then closes the confirmation, blocks the
 * action and offers only 「核对」, never a replay. Otherwise `text` says why in the UI language and
 * `details` keeps the Host's own message for 「技术详情」.
 */
export function ddlFailure(error, action, locale = 'zh-CN') {
  const details = error instanceof Error ? error.message : String(error?.message ?? error)
  const status = statusFromError(error)
  const drop = action === 'drop'
  if (outcomeUnknown(status)) {
    return { unknown: true, details, text: drop
      ? translate(locale, '删除请求已发出，但没有收到可信的答复，表可能已经删除。请先核对表列表，不要再次删除。')
      : translate(locale, '结构修改已发出，但没有收到可信的答复，语句可能已经执行。请先核对当前结构，不要再次应用。') }
  }
  const text = status.kind === 'forbidden' ? translate(locale, '当前身份没有修改表结构的权限。')
    : status.kind === 'database-busy' ? translate(locale, '数据库正忙，请稍后重试。')
      : status.kind === 'instance-unavailable' ? translate(locale, '实例暂时不可用，请求没有发出，可以稍后重试。')
        : status.kind === 'unsupported' ? translate(locale, '当前 Host 不支持这项数据库操作。')
          : drop ? translate(locale, '删除没有完成。请检查技术详情后重试。') : translate(locale, '结构修改没有完成。请检查技术详情后重试。')
  return { unknown: false, text, details }
}

/** 「核对」 for a drop with an unknown outcome: the fresh table list decides. */
export function dropCheckResult(tables, name, locale = 'zh-CN') {
  const present = Array.isArray(tables) && tables.some(table => table?.name === name)
  return present
    ? { applied: false, text: translate(locale, '核对结果：「{0}」仍在表列表中，删除没有执行，可以重新删除。', [name]) }
    : { applied: true, text: translate(locale, '核对结果：「{0}」已不在表列表中，删除已经生效。', [name]) }
}

/** 「核对」 for a new table with an unknown outcome: whether the fresh table list has it. */
export function createCheckResult(tables, name, locale = 'zh-CN') {
  const present = Array.isArray(tables) && tables.some(table => table?.name === name)
  return present
    ? { applied: true, text: translate(locale, '核对结果：表「{0}」已存在，新建已经生效。', [name]) }
    : { applied: false, text: translate(locale, '核对结果：表「{0}」不存在，新建没有执行，可以重新创建。', [name]) }
}

/** 「核对」 for a change to an existing table: the structure is read again; the person compares. */
export function alterCheckResult(locale = 'zh-CN') {
  return { applied: null, text: translate(locale, '已重新读取当前表结构。请对照确认修改是否已生效；需要时重新预览后再应用。') }
}
