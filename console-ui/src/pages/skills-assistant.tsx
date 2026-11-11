import { useI18n } from '../i18n'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ConnectionRequiredState } from '../components/connection-required'
import { useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { pluginRpc } from '../utils/plugin-rpc'
import { readErrorSummary } from '../utils/read-error.mjs'
import { useConsoleRead } from '../hooks/use-console-read'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { describeSkillsStatus, isPermissionDenied, validateSkillsStatus, type SkillsStatus } from './skills-assistant-model.mjs'

type StatusRead = { denied: true } | { denied: false; status: SkillsStatus }

async function readSkillsStatus(locale: 'zh-CN' | 'en'): Promise<StatusRead> {
  try {
    const data = await pluginRpc<unknown>('root', 'skills')
    return { denied: false, status: validateSkillsStatus(data, locale) }
  } catch (error) {
    if (isPermissionDenied(error)) return { denied: true }
    throw error
  }
}

function formatTime(timestamp: number, locale: 'zh-CN' | 'en'): string {
  return new Date(timestamp).toLocaleString(locale)
}

export default function SkillsAssistantPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <ConnectionRequiredState title={i18n.t("技能助手")} />
  return <SkillsAssistantSession key={scope} />
}

function SkillsAssistantSession() {
  const i18n = useI18n()
  const messages = useRef(i18n); messages.current = i18n
  const readStatus = useCallback(() => readSkillsStatus(messages.current.locale), [])
  const statusRead = useConsoleRead<StatusRead | null>(readStatus, null)
  return <PageShell>
    <PageHeader
      title={i18n.t("技能助手")}
      description={i18n.t("让一个专门的小助手帮机器人挑技能、挑工具、判断要不要接话。")}
      actions={<Button variant="outline" size="sm" onClick={() => void statusRead.refresh().catch(() => {})} disabled={statusRead.loading}><RefreshCw className={statusRead.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />
    <Button asChild variant="outline"><Link to="/features/ai?tab=purposes">{i18n.t("管理模型用途")}</Link></Button>
    <SkillsStatusSection read={statusRead} onRetry={() => { void statusRead.refresh().catch(() => {}) }} />
  </PageShell>
}

type StatusReadState = ReturnType<typeof useConsoleRead<StatusRead | null>>

function SkillsStatusSection({ read, onRetry }: { read: StatusReadState; onRetry: () => void }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-40 w-full" />
  if (read.error && !read.loaded) {
    return <ErrorAlert error={readErrorSummary(read.error, i18n.t("技能助手状态"))} onRetry={onRetry} />
  }
  if (!read.data) return null
  if (read.data.denied) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{i18n.t("当前账号没有查看技能助手的权限，请联系管理员开通。")}</CardContent></Card>
  }
  const view = describeSkillsStatus(read.data.status, i18n.locale)
  return <Card>
    <CardHeader>
      <CardTitle className="text-base">{i18n.t("最近 24 小时帮了 {0} 次", [view.totalCalls])}{view.failedCalls > 0 ? i18n.t("，其中 {0} 次没成功", [view.failedCalls]) : ''}</CardTitle>
      <CardDescription>{i18n.t("重启机器人后会重新计数。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {read.error && <p className="text-xs text-destructive">{i18n.t("刷新失败，下面是上次读到的数据。")}</p>}
      {view.tasks.length > 0
        ? <div className="grid gap-3 sm:grid-cols-2">
          {view.tasks.map((row) => <div key={row.task} className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.label}</span>
              <Badge variant={row.modeVariant}>{row.mode}</Badge>
            </div>
            <p className="text-muted-foreground">{i18n.t("用了 {0} 次：给出建议 {1} 次，没有合适的 {2} 次", [row.calls, row.helped, row.noSuggestion])}{row.failed > 0 ? i18n.t("，没成功 {0} 次", [row.failed]) : ''}</p>
            <p className="text-xs text-muted-foreground">{i18n.t("平均每次 ")}{row.averageTime}</p>
          </div>)}
        </div>
        : <p className="text-sm text-muted-foreground">{i18n.t("最近 24 小时还没有用到技能助手。")}</p>}
      {view.hasActivity && <div className="space-y-1">
        <h3 className="text-sm font-medium">{i18n.t("最近的记录")}</h3>
        <ul className="divide-y rounded-md border text-sm">
          {view.recent.map((entry) => <li key={`${entry.at}-${entry.label}-${entry.outcome}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="text-xs text-muted-foreground">{formatTime(entry.at, i18n.locale)}</span>
            <span>{entry.label}</span>
            <span className="text-muted-foreground">{entry.text}</span>
            <span className="text-xs text-muted-foreground">{entry.duration}</span>
          </li>)}
        </ul>
      </div>}
    </CardContent>
  </Card>
}
