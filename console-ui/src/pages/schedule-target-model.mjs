/**
 * Delivery target of a persistent schedule job as the Host resolves it (zhinjs/zhin#1250
 * `schedule-target-invisible`): `target: { resolved, display?, reason? }` on `schedule:list`
 * persistent rows and `GET /assistant/jobs` rows. Older Hosts send no `target`; callers then keep
 * their previous text. Pure.
 */
import { translate } from '../i18n/locale.mjs'

const REASONS = Object.freeze({
  missing_target: '没有设置发送目标',
  incomplete_target: '发送目标不完整',
  endpoint_not_found: '发送目标的聊天账号不存在或已改名',
})

/** Host-authored fixed displays that are copy, not data (other displays are account / conversation names). */
const FIXED_DISPLAYS = new Set(['不投递', '仅记录日志'])

/**
 * `{ valid, display, reason }` for a Host `target`, or null when the Host did not send one.
 * `display` is the account and conversation (`sandbox-bot（sandbox）· 私聊 u1`) or null;
 * `reason` is readable text for an unresolved target, null otherwise.
 */
export function scheduleTargetView(target, locale = 'zh-CN') {
  if (!target || typeof target !== 'object' || Array.isArray(target) || typeof target.resolved !== 'boolean') return null
  const raw = typeof target.display === 'string' && target.display.trim() ? target.display.trim() : null
  const display = raw && FIXED_DISPLAYS.has(raw) ? translate(locale, raw) : raw
  if (target.resolved) return { valid: true, display, reason: null, code: null }
  const code = typeof target.reason === 'string' && target.reason ? target.reason : null
  const reason = code && Object.hasOwn(REASONS, code) ? translate(locale, REASONS[code]) : translate(locale, '发送目标无效')
  return { valid: false, display, reason, code }
}

/** One line for an invalid target, naming the next run whose results will not arrive. */
export function scheduleTargetWarning(view, nextRunAt, locale = 'zh-CN') {
  if (!view || view.valid) return null
  return Number.isFinite(nextRunAt) && nextRunAt > 0
    ? translate(locale, '{0}；下次运行（{1}）的结果不会送达。', [view.reason, new Date(nextRunAt).toLocaleString(locale)])
    : translate(locale, '{0}；运行结果不会送达。', [view.reason])
}
