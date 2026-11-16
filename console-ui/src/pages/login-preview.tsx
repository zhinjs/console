import { MessageSquare, Reply, UserRound } from 'lucide-react'
import { StatCard } from '@zhin.js/console-ui'
import { BrandMark } from '../components/BrandMark'
import { useI18n } from '../i18n'

/**
 * Received / sent per hour for the sketch: fixed numbers, nothing is read from a Host. The last
 * hours are busier so the bars read as "a bot at work" at a glance.
 */
export const LOGIN_PREVIEW_HOURS: ReadonlyArray<readonly [inbound: number, outbound: number]> = [
  [4, 3], [6, 4], [3, 2], [8, 6], [12, 9], [9, 7], [14, 11], [11, 8], [16, 12], [13, 10], [18, 14], [15, 11],
]
const PEAK = Math.max(...LOGIN_PREVIEW_HOURS.map(([inbound, outbound]) => inbound + outbound))
const TOTAL_IN = LOGIN_PREVIEW_HOURS.reduce((sum, [inbound]) => sum + inbound, 0)
const TOTAL_OUT = LOGIN_PREVIEW_HOURS.reduce((sum, [, outbound]) => sum + outbound, 0)

/**
 * The login page's product sketch (console#125 phase 4): a scaled-down stat pair, hourly bars and
 * one chat exchange, drawn with the Console's own components and styles (StatCard, chart colors,
 * chat bubbles) so the first screen shows what the product is. Static sample data, no request; it
 * is decoration, so assistive technology skips it (`aria-hidden`) and nothing in it takes focus (`inert`).
 */
export function LoginPreview() {
  const i18n = useI18n()
  return (
    <div className="console-login-preview" aria-hidden="true" inert data-sample="">
      <div className="console-login-preview-stats">
        <StatCard icon={MessageSquare} label={i18n.t('收到消息')} value={TOTAL_IN}
          aside={<i className="console-login-preview-swatch is-inbound" />} sub={i18n.t('最近 12 小时')} />
        <StatCard icon={Reply} label={i18n.t('机器人发出')} value={TOTAL_OUT}
          aside={<i className="console-login-preview-swatch is-outbound" />} sub={i18n.t('最近 12 小时')} />
      </div>
      <div className="console-login-preview-bars">
        {LOGIN_PREVIEW_HOURS.map(([inbound, outbound], index) => (
          <span key={index} className="console-login-preview-bar" style={{ height: `${((inbound + outbound) / PEAK) * 100}%` }}>
            <span className="is-outbound" style={{ height: `${(outbound / (inbound + outbound)) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="console-login-preview-chat">
        <div className="console-login-preview-message is-in">
          <span className="console-login-preview-avatar"><UserRound /></span>
          <div className="im-bubble im-bubble-in">{i18n.t('今晚的值班表发一下？')}</div>
        </div>
        <div className="console-login-preview-message is-out">
          <div className="im-bubble im-bubble-out">{i18n.t('已发到群里：今晚 20:00 起是小周，明早 8:00 交给阿杰。')}</div>
          <BrandMark size={22} className="console-login-preview-avatar is-bot" />
        </div>
      </div>
    </div>
  )
}
