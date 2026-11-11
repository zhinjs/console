/**
 * 任务页指标卡的汇总逻辑。输入都是各标签页已有解析函数的结果，
 * 读取失败的来源传 null，对应指标显示为未知而不是 0。
 */

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

/** 定时提醒：内存定时任务与持久化提醒合计，以及已暂停的持久化提醒。 */
export function summarizeSchedules(list) {
  if (!list || typeof list !== 'object') return null
  const memory = Array.isArray(list.memory) ? list.memory : []
  const persistent = Array.isArray(list.persistent) ? list.persistent : []
  const paused = persistent.filter((item) => item?.enabled === false).length
    + memory.filter((item) => item?.running === false).length
  return { total: memory.length + persistent.length, persistent: persistent.length, paused }
}

/** 助手任务：总数、启用数，以及最近一次运行出错的任务数。 */
export function summarizeAssistantJobs(data) {
  if (!data || !Array.isArray(data.jobs)) return null
  let enabled = 0
  let failing = 0
  for (const job of data.jobs) {
    if (job?.enabled) enabled += 1
    const status = String(job?.state?.lastStatus ?? '').toLowerCase()
    if (job?.state?.lastError || status === 'error' || status === 'failed') failing += 1
  }
  return { total: data.jobs.length, enabled, failing }
}

const FAILED_RUN_STATUSES = new Set(['failed', 'interrupted', 'unsettled'])

/** 执行记录：只统计第一页（接口分页，没有总数），并标明是否还有更多。 */
export function summarizeExecutions(page) {
  if (!page || !Array.isArray(page.runs)) return null
  const failed = page.runs.filter((run) => FAILED_RUN_STATUSES.has(run?.status)).length
  const running = page.runs.filter((run) => run?.status === 'running' || run?.status === 'queued').length
  return { recent: page.runs.length, hasMore: Boolean(page.nextCursor), failed, running }
}
