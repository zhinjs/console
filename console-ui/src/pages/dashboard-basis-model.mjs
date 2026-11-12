/**
 * 首页指标的统计口径：消息量来自 Host 有界事件缓冲（`message.receive`），不是持久统计。
 * 纯函数，不读时钟：`now` 由调用方传入。
 */

/** 缓冲里的样本少于这个数时，比例类指标显示「样本不足」而不是一个看似精确的百分比。 */
export const MIN_RATIO_SAMPLE = 5

/**
 * 缓冲覆盖的时间范围。`truncated`：缓冲已满或 Host 报告还有更早的事件，最早一条之前的消息没计入。
 * 返回 `{ kind, since, until, windowStart }`：
 * - `none`：缓冲里没有消息（不知道是没有消息还是缓冲被清空）；
 * - `full`：覆盖整个窗口；
 * - `partial`：缓冲只追溯到 `since`，窗口前段未计入；
 * - `since-restart`：没有更早的事件，但最早一条晚于窗口开始（实例重启或刚开始收消息）。
 */
export function observationCoverage(records, { now, windowMs, truncated = false }) {
  const windowStart = now - windowMs
  const first = records?.length ? records[0].timestamp : null
  if (first === null || !Number.isFinite(first)) return { kind: 'none', since: null, until: now, windowStart }
  if (first <= windowStart) return { kind: 'full', since: windowStart, until: now, windowStart }
  return { kind: truncated ? 'partial' : 'since-restart', since: first, until: now, windowStart }
}

/**
 * 一个计数在口径下怎么展示：`unrecorded`（读取失败或从未有数据）/ `value`。
 * 缓冲为空且读取未完成时不是 0，是「未记录」。
 */
export function countReading(value, { loaded = true } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return { kind: 'unrecorded' }
  if (!loaded) return { kind: 'unrecorded' }
  return { kind: 'value', value }
}

/** 比例：分母不足 `minimum` 时 `insufficient`；分母缺失时 `unrecorded`。 */
export function ratioReading(part, total, minimum = MIN_RATIO_SAMPLE) {
  if (!Number.isFinite(part) || !Number.isFinite(total)) return { kind: 'unrecorded' }
  if (total < minimum) return { kind: 'insufficient', sample: Math.max(0, total) }
  return { kind: 'value', value: Math.min(100, Math.max(0, Math.round((part / total) * 100))) }
}

/**
 * 首页消息流里的「回复」是按同一会话、前后两分钟内的时间接近配对的，并没有回复关系的证据：
 * 统一称「可能相关」。
 */
export const REPLY_PAIRING_BASIS = 'time-proximity'
