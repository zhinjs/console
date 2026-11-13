import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { getApiBase, getToken } from '../../utils/auth'
import { CONSOLE_PATHS } from '../../console-routes.mjs'
import {
  SELF_CHECK_IDS, runSelfChecks, selfCheckCopy, selfCheckDetail, selfCheckSummary,
  type SelfCheckId, type SelfCheckResult,
} from './self-check-model.mjs'
import './self-check.css'

const STATUS_ICONS = { pass: CheckCircle2, fail: XCircle, warn: AlertTriangle, skip: CircleSlash } as const
const STATUS_BADGES = { pass: 'success', fail: 'destructive', warn: 'warning', skip: 'outline' } as const

const NGINX_SNIPPET = `location /zhin/ {
  proxy_pass http://127.0.0.1:8086/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 1h;
}`

/**
 * 连接自检: checks that run in this browser against the Host it is signed in to — reachability of
 * the API base, base path, mixed content, clock, sign-in, the event stream and a WebSocket upgrade.
 * Every check says pass / fail, what it means and how to fix it. Uses existing routes only.
 */
export default function SelfCheckPage() {
  const i18n = useI18n()
  const [results, setResults] = useState<ReadonlyMap<SelfCheckId, SelfCheckResult>>(() => new Map())
  const [running, setRunning] = useState(false)
  const [ranAt, setRanAt] = useState<number | null>(null)
  const run = useRef(0)
  const apiBase = getApiBase()

  const start = useCallback(() => {
    const id = ++run.current
    setRunning(true)
    setResults(new Map())
    void runSelfChecks({
      fetch: (input, init) => window.fetch(input, init),
      WebSocket: typeof window.WebSocket === 'function' ? window.WebSocket as never : undefined,
      apiBase: getApiBase(),
      pageHref: window.location.href,
      pageProtocol: window.location.protocol,
      token: getToken(),
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: timer => window.clearTimeout(timer as number),
    }, check => {
      if (run.current === id) setResults(previous => new Map(previous).set(check.id, check))
    }).finally(() => {
      if (run.current !== id) return
      setRunning(false)
      setRanAt(Date.now())
    })
  }, [])

  useEffect(() => {
    start()
    return () => { run.current += 1 }
  }, [start])

  const done = [...results.values()]
  const summary = selfCheckSummary(done)
  const t = (message: string, values?: readonly unknown[]) => i18n.t(message, values)
  const statusLabel = (status: SelfCheckResult['status']) => status === 'pass' ? i18n.t('通过') : status === 'fail' ? i18n.t('未通过') : status === 'warn' ? i18n.t('需要注意') : i18n.t('跳过')

  return (
    <PageShell>
      <PageHeader
        title={i18n.t('连接自检')}
        description={i18n.t('在这个浏览器里检查 Console 到 Host 的每一段连接，找出一直「正在连接」的原因。')}
        actions={<Button variant="outline" onClick={start} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}{running ? i18n.t('检查中…') : i18n.t('重新检查')}
        </Button>}
      />
      <Card className="console-self-check-summary p-4" role="status" aria-live="polite" data-summary={running ? 'running' : summary.status}>
        <div className="console-self-check-target">
          <span>{i18n.t('检查的 Host')}</span><code title={apiBase}>{apiBase || '—'}</code>
          <span>{i18n.t('Console 页面')}</span><code title={typeof window === 'undefined' ? '' : window.location.origin}>{typeof window === 'undefined' ? '—' : window.location.origin}</code>
        </div>
        <p className="console-self-check-verdict">
          {running ? i18n.t('正在检查 {0} / {1} 项…', [done.length, SELF_CHECK_IDS.length])
            : summary.status === 'pass' ? i18n.t('全部通过。如果页面仍然卡住，请刷新页面或查看「实例」页的日志。')
              : summary.status === 'warn' ? i18n.t('{0} 项需要注意，查看下面的说明。', [summary.warned])
                : i18n.t('{0} 项未通过，按下面的提示修复后重新检查。', [summary.failed])}
        </p>
        {ranAt && !running ? <p className="console-self-check-time">{i18n.t('检查时间：{0}', [i18n.date(ranAt, { timeStyle: 'medium' })])}</p> : null}
      </Card>

      <ol className="console-self-check-list" aria-label={i18n.t('检查项')}>
        {SELF_CHECK_IDS.map(id => {
          const check = results.get(id)
          const copy = selfCheckCopy(id, t)
          const Icon = check ? STATUS_ICONS[check.status] : Loader2
          const detail = check ? selfCheckDetail(check, t) : null
          return (
            <li key={id} className="console-self-check-item" data-check={id} data-status={check?.status ?? 'running'}>
              <Icon className={check ? 'console-self-check-icon' : 'console-self-check-icon animate-spin'} aria-hidden="true" />
              <div className="console-self-check-body">
                <div className="console-self-check-head">
                  <h2 className="console-self-check-title">{copy.title}</h2>
                  <Badge variant={check ? STATUS_BADGES[check.status] : 'outline'} size="sm">{check ? statusLabel(check.status) : i18n.t('检查中')}</Badge>
                </div>
                <p className="console-self-check-explain">{copy.explain}</p>
                {detail ? <p className="console-self-check-detail">{detail}</p> : null}
                {check && (check.status === 'fail' || check.status === 'warn') ? (
                  <p className="console-self-check-fix"><strong>{i18n.t('怎么修：')}</strong>{copy.fix}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <details className="console-self-check-snippet">
        <summary>{i18n.t('nginx 反向代理参考配置')}</summary>
        <p>{i18n.t('把 Host 放在路径 /zhin/ 下时的写法；API 地址填 https://你的域名/zhin。')}</p>
        <pre><code>{NGINX_SNIPPET}</code></pre>
      </details>
      <p className="console-self-check-more">
        {i18n.t('实例本身的状态与日志在')}{' '}<Link to={CONSOLE_PATHS.opsInstance}>{i18n.t('「实例」页')}</Link>{i18n.t('；也可以在 Host 上运行 zhin status 与 zhin logs。')}
      </p>
    </PageShell>
  )
}
