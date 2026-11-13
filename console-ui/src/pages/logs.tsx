import { useI18n } from '../i18n'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { LogViewer } from './logs/LogViewer'

/**
 * /logs：筛选写在地址栏（`?q=` `?level=` `?adapter=&endpoint=` …），深链与书签照旧可用。
 * 查看器本身是 LogViewer，底部日志面板用的是同一个组件（状态在内存里）。
 */
export default function LogsPage() {
  const i18n = useI18n()
  // Clearing logs is a host operation; viewers only read.
  const readOnly = !hasConsolePermission('ops.config.write')
  const [searchParams, setSearchParams] = useSearchParams()
  return (
    <PageShell className="console-logs-page max-w-[1800px]">
      <PageHeader
        title={i18n.t("运行日志")}
        description={readOnly ? i18n.t("实时查看与筛选系统运行日志（只读）。") : i18n.t("查看历史与实时日志，定位运行异常。")}
      />
      <LogViewer params={searchParams} onParamsChange={next => setSearchParams(next, { replace: true })} />
    </PageShell>
  )
}
