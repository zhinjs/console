import { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { PageHeader } from '../../components/PageHeader'
import { PageShell } from '../../components/PageShell'
import { StatusState } from '../../components/StatusState'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { attentionSeverityLabel, groupAttention } from './attention-model.mjs'
import { AttentionItemRow, AttentionSeverityIcon } from './AttentionItemRow'
import { useAttention } from './use-attention'
import './attention.css'

type AttentionView = 'open' | 'hidden'

/** Name of an `unavailable` source; unknown names stay as the Host sent them. */
function sourceLabel(name: string, t: (message: string) => string): string {
  switch (name) {
    case 'login-assist': return t('登录辅助')
    case 'endpoints': return t('聊天账号')
    case 'plugins': return t('插件')
    case 'config': return t('配置文件')
    case 'tool-approvals': return t('工具审批')
    case 'mcp': return t('MCP 服务')
    case 'logs': return t('日志')
    default: return name
  }
}

/**
 * 「需要你处理」: everything that waits for the operator, grouped by severity, each with a deep link
 * to where it is fixed. 「稍后提醒」 / 「忽略」 only hide an item for this viewer in this browser.
 */
export default function AttentionPage() {
  const i18n = useI18n()
  const attention = useAttention()
  const { state, active, snoozed, ignored } = attention
  const [view, setView] = useState<AttentionView>('open')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setNow(Date.now()) }, [state.data])
  const hiddenCount = snoozed.length + ignored.length
  const data = state.data
  const checkedAt = data?.generatedAt ? new Date(data.generatedAt).toLocaleString(i18n.locale) : null

  const header = (
    <PageHeader
      title={i18n.t('需要你处理')}
      description={i18n.t('登录、账号、插件、配置、审批等需要你动手的事项都汇总在这里，点「去处理」直达修复的位置。')}
      actions={(
        <Button variant="outline" onClick={attention.refresh} disabled={state.refreshing}>
          <RefreshCw className={state.refreshing ? 'animate-spin' : ''} />
          {i18n.t('刷新')}
        </Button>
      )}
    />
  )

  if (!attention.allowed) {
    return <PageShell className="console-attention-page">{header}<StatusState kind="forbidden" permissions={['status.view']} /></PageShell>
  }
  if (!data) {
    return (
      <PageShell className="console-attention-page">
        {header}
        {state.status === 'error'
          ? <StatusState error={state.error} onRetry={attention.refresh} />
          : <div className="space-y-2" aria-label={i18n.t('正在读取需要处理的事项…')}><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}
      </PageShell>
    )
  }

  const shown = view === 'open' ? active : [...snoozed, ...ignored]
  const hiddenReason = (id: string) => snoozed.some(item => item.id === id) ? 'snoozed' as const : 'ignored' as const

  return (
    <PageShell className="console-attention-page">
      {header}

      <div className="console-attention-toolbar">
        <div className="console-attention-filters" role="group" aria-label={i18n.t('显示')}>
          <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')} className={cn('console-attention-filter', view === 'open' && 'is-active')}>
            {i18n.t('待处理')}<span className="console-attention-filter-count">{active.length}</span>
          </button>
          <button type="button" aria-pressed={view === 'hidden'} onClick={() => setView('hidden')} className={cn('console-attention-filter', view === 'hidden' && 'is-active')}>
            {i18n.t('已忽略')}<span className="console-attention-filter-count">{hiddenCount}</span>
          </button>
        </div>
        {checkedAt ? <span className="console-attention-checked">{i18n.t('上次检查 {0}', [checkedAt])}</span> : null}
      </div>

      {state.status === 'ready' && state.error ? (
        <StatusState compact error={state.error} onRetry={attention.refresh} description={i18n.t('刷新失败，下面是上次读取的结果。')} />
      ) : null}
      {data.mode === 'fallback' ? (
        <p className="console-attention-note">{i18n.t('当前 Host 版本较旧，还不能汇总登录、插件、配置和审批事项；这里只列出 Console 能从运行状态推断的几项。升级 Host 后会显示完整列表。')}</p>
      ) : null}
      {data.unavailable.length ? (
        <p className="console-attention-note is-warning">
          {i18n.t('以下来源这次没能读取，列表可能不完整：{0}', [data.unavailable.map(name => sourceLabel(name, i18n.t)).join(i18n.locale === 'en' ? ', ' : '、')])}
        </p>
      ) : null}

      {shown.length === 0 ? (
        view === 'open' ? (
          <div className="console-attention-empty" role="status">
            <CheckCircle2 aria-hidden="true" />
            <p className="console-attention-empty-title">{i18n.t('一切正常')}</p>
            <p className="console-attention-empty-detail">
              {hiddenCount > 0
                ? i18n.t('没有待处理的事项；另有 {0} 项被你推迟或忽略。', [hiddenCount])
                : i18n.t('没有需要你处理的事项。')}
              {checkedAt ? ` ${i18n.t('上次检查 {0}', [checkedAt])}` : ''}
            </p>
          </div>
        ) : (
          <StatusState kind="empty" title={i18n.t('没有推迟或忽略的事项')} description={i18n.t('在事项上点「稍后提醒」或「忽略」后，会出现在这里，可随时恢复。')} />
        )
      ) : (
        groupAttention(shown).map(group => (
          <section key={group.severity} className="console-attention-group" aria-labelledby={`attention-group-${group.severity}`}>
            <h2 id={`attention-group-${group.severity}`} className="console-attention-group-title">
              <AttentionSeverityIcon severity={group.severity} />
              {attentionSeverityLabel(group.severity, i18n.locale)}
              <span className="console-attention-group-count">{group.items.length}</span>
            </h2>
            <ul className="console-attention-list">
              {group.items.map(item => (
                <AttentionItemRow
                  key={item.id}
                  item={item}
                  now={now}
                  {...(view === 'hidden' ? { hidden: hiddenReason(item.id) } : {})}
                  onSnooze={attention.snooze}
                  onIgnore={attention.ignore}
                  onRestore={attention.restore}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </PageShell>
  )
}
