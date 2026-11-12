/**
 * 定时任务「全部任务」统一视图：把管理员任务、定时提醒、助手任务和待审批的工具调用排成一张表
 * （类型 / 状态 / 下次运行 / 最近结果 / 目标 / 审批）。输入是各页签已有解析函数的结果，
 * 读取失败的来源传 null，并在 `unavailable` 里列出，不当成「没有任务」。纯函数。
 */
import { translate } from '../i18n/locale.mjs'
import { conversationHref } from '../console-routes.mjs'

const KINDS = new Set(['private', 'group', 'channel'])

function statusOf(code, locale) {
  const t = text => translate(locale, text)
  const table = {
    scheduled: [t('已排期'), 'secondary'],
    running: [t('运行中'), 'info'],
    paused: [t('已暂停'), 'secondary'],
    failed: [t('失败'), 'destructive'],
    unknown: [t('结果不确定'), 'warning'],
    succeeded: [t('已完成'), 'success'],
    cancelled: [t('已取消'), 'secondary'],
    enabled: [t('已启用'), 'success'],
    pending: [t('待审批'), 'warning'],
  }
  const [label, tone] = table[code] ?? [code, 'secondary']
  return { code, label, tone }
}

function lastResultOf(status, at, locale) {
  const value = String(status ?? '').toLowerCase()
  if (!value) return null
  const t = text => translate(locale, text)
  if (value === 'ok' || value === 'succeeded' || value === 'success') return { label: t('成功'), tone: 'success', at }
  if (value === 'error' || value === 'failed') return { label: t('失败'), tone: 'destructive', at }
  if (value === 'skipped') return { label: t('已跳过'), tone: 'secondary', at }
  return { label: value, tone: 'secondary', at }
}

function adminTarget(target) {
  const endpoint = target?.endpoint
  if (!endpoint?.adapter || !endpoint.id || !KINDS.has(target.kind) || !target.id) return { label: null, href: null }
  return {
    label: `${endpoint.adapter} / ${endpoint.id} / ${target.kind}:${target.id}`,
    href: conversationHref(endpoint.adapter, endpoint.id, target.kind, target.id),
  }
}

const finite = value => (Number.isFinite(value) ? value : null)

/**
 * `sources`：`{ admin: TaskProviders | null, schedules: { memory, persistent } | null,
 * assistant: { jobs } | null, approvals: { pending } | null }`。
 * 返回 `{ rows, unavailable }`；`unavailable` 是读取失败的来源 id（`admin` / `schedule` / `assistant` / `approvals`）。
 */
export function taskOverviewRows(sources, locale = 'zh-CN') {
  const t = (text, values) => translate(locale, text, values)
  const rows = []
  const unavailable = []
  const { admin, schedules, assistant, approvals } = sources ?? {}

  if (admin && Array.isArray(admin.providers)) {
    for (const provider of admin.providers) {
      for (const task of provider?.tasks ?? []) {
        const target = adminTarget(task.target)
        rows.push({
          key: `admin:${provider.owner}:${task.id}`,
          type: 'admin',
          typeLabel: t('管理员任务'),
          title: task.title || task.id,
          detail: provider.title,
          status: statusOf(task.state, locale),
          nextRunAt: finite(task.nextRunAt),
          lastResult: task.state === 'succeeded' || task.state === 'failed' ? lastResultOf(task.state, finite(task.lastRunAt), locale) : task.lastRunAt ? { label: t('已执行'), tone: 'secondary', at: task.lastRunAt } : null,
          target: target.label,
          targetHref: target.href,
          approval: t('创建前已人工核对'),
          tab: 'admin',
        })
      }
    }
  } else unavailable.push('admin')

  const persistentIds = new Set()
  if (schedules && typeof schedules === 'object') {
    for (const item of Array.isArray(schedules.memory) ? schedules.memory : []) {
      rows.push({
        key: `memory:${item.id ?? item.expression}:${item.plugin ?? ''}`,
        type: 'schedule',
        typeLabel: t('定时提醒'),
        title: item.description || item.id || item.expression,
        detail: item.expression,
        status: statusOf(item.running === false ? 'paused' : 'running', locale),
        nextRunAt: finite(item.nextExecution),
        lastResult: null,
        target: item.plugin ? t('插件 {0}', [item.plugin]) : null,
        targetHref: null,
        approval: null,
        tab: 'schedule',
      })
    }
    for (const item of Array.isArray(schedules.persistent) ? schedules.persistent : []) {
      persistentIds.add(item.id)
      rows.push({
        key: `persistent:${item.id}`,
        type: 'schedule',
        typeLabel: t('定时提醒'),
        title: item.label || item.prompt || item.id,
        detail: item.cronExpression,
        status: statusOf(item.enabled === false ? 'paused' : 'enabled', locale),
        nextRunAt: finite(item.nextExecution),
        lastResult: lastResultOf(item.lastStatus, finite(item.lastExecutedAt), locale),
        target: t('AI 助手'),
        targetHref: null,
        approval: null,
        tab: 'schedule',
      })
    }
  } else unavailable.push('schedule')

  if (assistant && Array.isArray(assistant.jobs)) {
    for (const job of assistant.jobs) {
      // 持久化定时提醒同时是一项助手任务：只列一次。
      if (persistentIds.has(job.id)) continue
      const failing = Boolean(job.state?.lastError) || ['error', 'failed'].includes(String(job.state?.lastStatus ?? '').toLowerCase())
      rows.push({
        key: `assistant:${job.id}`,
        type: 'assistant',
        typeLabel: t('助手任务'),
        title: job.label || job.id,
        detail: job.label ? job.id : null,
        status: statusOf(job.enabled ? 'enabled' : 'paused', locale),
        nextRunAt: finite(job.state?.nextRunAtMs),
        lastResult: failing ? lastResultOf('error', null, locale) : lastResultOf(job.state?.lastStatus, null, locale),
        target: t('AI 助手'),
        targetHref: null,
        approval: null,
        tab: 'assistant',
      })
    }
  } else unavailable.push('assistant')

  if (approvals && Array.isArray(approvals.pending)) {
    for (const card of approvals.pending) {
      rows.push({
        key: `approval:${card.id}`,
        type: 'approval',
        typeLabel: t('工具调用'),
        title: card.toolName,
        detail: null,
        status: statusOf('pending', locale),
        nextRunAt: null,
        expiresAt: finite(card.expiresAt),
        lastResult: null,
        target: card.sessionKey || null,
        targetHref: null,
        approval: t('等待审批，{0} 前有效', [new Date(card.expiresAt).toLocaleString(locale)]),
        tab: 'admin',
      })
    }
  } else if (approvals !== undefined) unavailable.push('approvals')

  const urgency = row => row.type === 'approval' ? 0 : row.status.tone === 'destructive' || row.lastResult?.tone === 'destructive' ? 1 : row.status.tone === 'warning' ? 2 : 3
  rows.sort((a, b) => urgency(a) - urgency(b)
    || (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title))
  return { rows, unavailable }
}

/**
 * 状态筛选（不按类型：类型由上方页签负责）。`attention` 是需要人处理的行——待审批、失败、结果不确定或
 * 最近一次运行失败；`paused` 是已暂停；`all` 不筛。
 */
export const TASK_OVERVIEW_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: '全部' }),
  Object.freeze({ id: 'attention', label: '需要处理' }),
  Object.freeze({ id: 'paused', label: '已暂停' }),
])

export function needsAttention(row) {
  return row.type === 'approval'
    || row.status.tone === 'destructive' || row.status.tone === 'warning'
    || row.lastResult?.tone === 'destructive'
}

export function filterTaskOverview(rows, filter) {
  if (filter === 'attention') return rows.filter(needsAttention)
  if (filter === 'paused') return rows.filter(row => row.status.code === 'paused')
  return rows
}
