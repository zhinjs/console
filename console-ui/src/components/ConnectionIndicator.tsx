import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RefreshCw, Stethoscope, Unplug } from 'lucide-react'
import { cn, useConsoleClient } from '@zhin.js/client'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import {
  EVENT_STREAM_REASON_COPY, connectionIndicatorView, getEventStreamFailure, subscribeEventStreamFailure,
} from '../utils/event-stream-status.mjs'
import './connection-indicator.css'

/**
 * The top bar's live-connection state: a dot while the Console event stream is connected, else a
 * small 「连接中」/「重连中」/「已断开（原因）」 button whose popover explains, retries and links to
 * the self-check. Reads the SDK transport's own state and the stream replies it saw
 * (`utils/event-stream-status.mjs`); it disappears again once connected.
 */
export function ConnectionIndicator() {
  const i18n = useI18n()
  const { transport } = useConsoleClient()
  const state = useSyncExternalStore(
    notify => transport.onConnectionChange(notify),
    () => String(transport.getState()),
    () => 'connecting',
  )
  const failure = useSyncExternalStore(subscribeEventStreamFailure, getEventStreamFailure, getEventStreamFailure)
  // Per transport: whether it was ever connected, and since when it is not.
  const track = useRef<{ transport: unknown; ever: boolean; since: number }>({ transport, ever: false, since: Date.now() })
  if (track.current.transport !== transport) track.current = { transport, ever: false, since: Date.now() }
  const connected = state === 'connected'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (connected) { track.current.ever = true; return }
    track.current.since = Date.now()
  }, [connected])
  // The SDK does not announce every step (connecting → reconnecting); re-read while not connected.
  useEffect(() => {
    if (connected) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [connected])
  const [retrying, setRetrying] = useState(false)
  useEffect(() => { if (connected) setRetrying(false) }, [connected])

  const view = connectionIndicatorView({ state, failure, ever: track.current.ever, since: track.current.since, now })
  if (!view) {
    const title = connected ? i18n.t('Console 实时事件已连接') : i18n.t('Console 实时事件未连接')
    return <span className={cn('console-connection-dot', connected ? 'is-online' : 'is-offline')} title={title} aria-label={title} role="status" />
  }
  const label = view.kind === 'disconnected' ? i18n.t('已断开') : view.kind === 'reconnecting' ? i18n.t('重连中') : i18n.t('连接中')
  const reason = view.reason ? i18n.t(EVENT_STREAM_REASON_COPY[view.reason.code], [view.reason.status ?? '']) : null
  const retry = () => {
    setRetrying(true)
    try { transport.connect() } catch { /* a disposed transport is replaced on the next session */ }
    window.setTimeout(() => setRetrying(false), 1500)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('console-connection-pill', `is-${view.kind}`)} data-connection={view.kind}
          aria-label={reason ? i18n.t('实时连接：{0}（{1}）', [label, reason]) : i18n.t('实时连接：{0}', [label])}
          title={reason ? i18n.t('实时连接：{0}（{1}）', [label, reason]) : i18n.t('实时连接：{0}', [label])}>
          {view.kind === 'disconnected' ? <Unplug aria-hidden="true" /> : <Loader2 className="animate-spin" aria-hidden="true" />}
          <span className="console-connection-pill-label">{label}</span>
          {view.kind === 'disconnected' && reason ? <span className="console-connection-pill-reason">（{reason}）</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="console-connection-popover" role="dialog" aria-label={i18n.t('实时连接')}>
        <p className="console-connection-popover-title">{view.kind === 'disconnected' ? i18n.t('实时事件已断开') : view.kind === 'reconnecting' ? i18n.t('正在重新连接实时事件') : i18n.t('正在连接实时事件')}</p>
        <p className="console-connection-popover-text">
          {view.kind === 'disconnected'
            ? i18n.t('多次重连都没有成功，新消息、日志和状态不会自动出现。页面上的读取和保存仍然走普通请求。')
            : i18n.t('新消息、日志和状态的推送暂停，连上后会自动补齐。页面上的读取和保存不受影响。')}
        </p>
        {reason ? <p className="console-connection-popover-text">{i18n.t('原因：{0}', [reason])}</p> : null}
        <div className="console-connection-popover-actions">
          <Button size="sm" variant="outline" onClick={retry} disabled={retrying}><RefreshCw className={retrying ? 'animate-spin' : ''} />{i18n.t('重试')}</Button>
          <Button asChild size="sm" variant="ghost"><Link to={CONSOLE_PATHS.opsSelfCheck}><Stethoscope />{i18n.t('连接自检')}</Link></Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
