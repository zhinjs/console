/**
 * 任务页指标卡的汇总逻辑。输入都是各标签页已有解析函数的结果，
 * 读取失败的来源传 null，对应指标显示为未知而不是 0。
 */
import { isPluginInternalSchedule } from './schedule-memory-model.mjs'
import { featureDisabledState } from '../utils/feature-disabled.mjs'

/** 管理员任务：所有用途提供方下的任务总数与已暂停数。 */
export function summarizeAdminTasks(catalog) {
  if (!catalog || !Array.isArray(catalog.providers)) return null
  let total = 0
  let paused = 0
  let failed = 0
  for (const provider of catalog.providers) {
    for (const task of provider?.tasks ?? []) {
      total += 1
      if (task?.state === 'paused') paused += 1
      if (task?.state === 'failed') failed += 1
    }
  }
  return { total, paused, failed, providers: catalog.providers.length }
}

/**
 * 定时提醒：内存定时任务与持久化提醒合计，以及已暂停的持久化提醒。插件内部任务（`kind: 'plugin-internal'`，
 * 轮询、清理等）不算提醒，单独计入 `internal`（zhinjs/zhin#1250）。
 */
export function summarizeSchedules(list) {
  if (!list || typeof list !== 'object') return null
  const all = Array.isArray(list.memory) ? list.memory : []
  const memory = all.filter((item) => !isPluginInternalSchedule(item))
  const persistent = Array.isArray(list.persistent) ? list.persistent : []
  const paused = persistent.filter((item) => item?.enabled === false).length
    + memory.filter((item) => item?.running === false).length
  return { total: memory.length + persistent.length, persistent: persistent.length, paused, internal: all.length - memory.length }
}

/**
 * 助手任务：总数、启用数，以及最近一次运行出错的任务数。Host 说明助手未启用时（#1250 `status: 'disabled'`）
 * 带上 `disabled`（本地化的原因），卡片显示「未启用」而不是 0 个任务。
 */
export function summarizeAssistantJobs(data, locale = 'zh-CN', reminderIds = []) {
  if (!data || !Array.isArray(data.jobs)) return null
  const disabled = featureDisabledState(data, locale)
  if (disabled) return { total: 0, enabled: 0, failing: 0, disabled: disabled.description }
  // A persistent reminder is also an assistant job (same id): it is counted on the reminder card only
  // (#64 schedule-tabs-overlap), as 全部任务 lists it once.
  const reminders = new Set(reminderIds)
  const own = data.jobs.filter(job => !reminders.has(job?.id))
  let enabled = 0
  let failing = 0
  for (const job of own) {
    if (job?.enabled) enabled += 1
    const status = String(job?.state?.lastStatus ?? '').toLowerCase()
    if (job?.state?.lastError || status === 'error' || status === 'failed') failing += 1
  }
  return { total: own.length, enabled, failing, reminders: data.jobs.length - own.length }
}

const FAILED_RUN_STATUSES = new Set(['failed', 'interrupted', 'unsettled'])

/** 执行记录：只统计第一页（接口分页，没有总数），并标明是否还有更多。 */
export function summarizeExecutions(page) {
  if (!page || !Array.isArray(page.runs)) return null
  const failed = page.runs.filter((run) => FAILED_RUN_STATUSES.has(run?.status)).length
  const running = page.runs.filter((run) => run?.status === 'running' || run?.status === 'queued').length
  return { recent: page.runs.length, hasMore: Boolean(page.nextCursor), failed, running }
}
