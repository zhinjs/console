import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, ServerOff } from 'lucide-react'
import './status-surfaces.css'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { requestConsole } from '../utils/console-rpc'
import { GATEWAY_INSTANCE_RPC, type GatewayInstanceStatus } from '../contracts/gateway'
import { onHostGatewayReply } from '../utils/auth'
import {
  clearInstanceAvailability, reportHttpReply, getInstanceAvailability, instanceStateAnswers, rearmInstanceRetry, secondsUntilRetry, subscribeInstanceAvailability,
} from '../utils/instance-availability.mjs'

// Raw `apiFetch` replies (plugin RPCs, approvals) report instance failures too.
onHostGatewayReply(reply => { reportHttpReply(reply) })

/**
 * Probe once: the gateway's own `gateway.instance.status` says whether the instance runs; when the
 * gateway does not answer it (older gateway, no `status.view`), an instance request answers instead
 * (its success clears the banner through requestConsole).
 */
async function probeInstance(): Promise<boolean> {
  try {
    const status = await requestConsole<GatewayInstanceStatus>({ type: GATEWAY_INSTANCE_RPC.STATUS })
    if (status && typeof status === 'object' && typeof status.state === 'string') {
      if (!instanceStateAnswers(status.state)) return false
    }
  } catch {
    // Fall through to an instance request.
  }
  try {
    await requestConsole({ type: 'endpoint.list' })
    return true
  } catch {
    return getInstanceAvailability() === null
  }
}

/**
 * Shell banner while the Zhin instance does not answer (gateway 503 `instance_unavailable`, 504
 * `instance_timeout`, 502 `instance_error`). It never covers the page: gateway pages (访问控制、实例、
 * 终端) keep working. Counts down the Retry-After, probes automatically and disappears on recovery.
 */
export function InstanceUnavailableBanner() {
  const i18n = useI18n()
  const state = useSyncExternalStore(subscribeInstanceAvailability, getInstanceAvailability, getInstanceAvailability)
  const [now, setNow] = useState(() => Date.now())
  const [probing, setProbing] = useState(false)
  const probingRef = useRef(false)

  useEffect(() => {
    if (!state) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state])

  const probe = () => {
    if (probingRef.current) return
    probingRef.current = true
    setProbing(true)
    void probeInstance().then(ok => {
      if (ok) clearInstanceAvailability(); else rearmInstanceRetry()
    }).finally(() => {
      probingRef.current = false
      setProbing(false)
    })
  }

  const remaining = secondsUntilRetry(state, now)
  useEffect(() => {
    if (state && remaining === 0 && !probingRef.current) probe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, remaining])

  if (!state) return null
  const reason = state.instance === 'timeout' ? i18n.t('实例没有在限定时间内答复，刚才的操作结果未知，请核对后再决定是否重试。')
    : state.instance === 'error' ? i18n.t('实例答复失败或过载。')
      : i18n.t('Zhin 实例没有在运行。')
  return (
    <div className="console-instance-banner" role="status" aria-live="polite">
      <ServerOff className="console-instance-banner-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="console-instance-banner-title">{i18n.t('实例不可用')}</p>
        <p className="console-instance-banner-text">
          {reason}{' '}
          {probing ? i18n.t('正在检查…') : i18n.t('{0} 秒后自动重试。', [remaining])}
          {' '}{i18n.t('访问控制、实例与终端仍可使用。')}
        </p>
      </div>
      <div className="console-instance-banner-actions">
        <Button size="sm" variant="outline" onClick={probe} disabled={probing}><RefreshCw className={probing ? 'animate-spin' : ''} />{i18n.t('立即重试')}</Button>
        <Button asChild size="sm" variant="outline"><Link to="/ops/instance">{i18n.t('查看实例')}</Link></Button>
      </div>
    </div>
  )
}
