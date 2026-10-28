import { translate } from '../i18n/locale.mjs'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const step = field => /^\*\/([1-9]\d*)$/.exec(field)?.[1]
const fixed = (field, max) => /^\d+$/.test(field) && Number(field) <= max ? Number(field) : null
const clock = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** Plain-language reading of common cron shapes; unknown shapes return null so callers show the raw expression. */
export function describeCron(expression, locale = 'zh-CN') {
  const parts = String(expression ?? '').trim().split(/\s+/)
  if (parts.length !== 5 && parts.length !== 6) return null
  const [sec, min, hour, dom, mon, dow] = parts.length === 6 ? parts : ['0', ...parts]
  const t = (text, args) => translate(locale, text, args)
  const everyDay = dom === '*' && mon === '*'
  if (!everyDay) return null
  if (dow === '*') {
    if (step(sec) && min === '*' && hour === '*') return t('每 {0} 秒', [step(sec)])
    if (sec === '*' && min === '*' && hour === '*') return t('每秒')
    if (fixed(sec, 59) !== null) {
      if (min === '*' && hour === '*') return t('每分钟')
      if (step(min) && hour === '*') return t('每 {0} 分钟', [step(min)])
      if (fixed(min, 59) !== null && hour === '*') return t('每小时第 {0} 分', [fixed(min, 59)])
      if (fixed(min, 59) !== null && step(hour)) return t('每 {0} 小时', [step(hour)])
      if (fixed(min, 59) !== null && fixed(hour, 23) !== null) return t('每天 {0}', [clock(fixed(hour, 23), fixed(min, 59))])
    }
    return null
  }
  const day = fixed(dow, 7)
  if (day !== null && fixed(sec, 59) !== null && fixed(min, 59) !== null && fixed(hour, 23) !== null) {
    return t('每{0} {1}', [t(WEEKDAYS[day % 7]), clock(fixed(hour, 23), fixed(min, 59))])
  }
  return null
}

/** Short relative time for an upcoming run, e.g. “3 分钟后”. Past or missing values return null. */
export function relativeUntil(timestamp, now = Date.now(), locale = 'zh-CN') {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  const seconds = Math.round((timestamp - now) / 1000)
  if (seconds < 0) return null
  const t = (text, args) => translate(locale, text, args)
  if (seconds < 60) return t('{0} 秒后', [seconds])
  if (seconds < 3600) return t('{0} 分钟后', [Math.round(seconds / 60)])
  if (seconds < 86400) return t('{0} 小时后', [Math.round(seconds / 3600)])
  return t('{0} 天后', [Math.round(seconds / 86400)])
}
