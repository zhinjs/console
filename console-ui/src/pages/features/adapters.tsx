import { Link } from 'react-router-dom'
import { Cable, ChevronRight, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { adapterHref } from '../../console-routes.mjs'
import { summarizeAdapters } from './feature-model.mjs'
import { useEndpointList } from './use-feature-data'

export default function AdaptersPage() {
  const i18n = useI18n()
  const { endpoints, loading, loaded, error, refresh } = useEndpointList()
  const adapters = summarizeAdapters(endpoints)
  return (
    <PageShell>
      <PageHeader
        title={i18n.t("适配器")}
        description={i18n.t("每个适配器实例的账号与在线情况。进入适配器管理账号连接。")}
        actions={<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
      />
      {error ? <ErrorAlert error={error} onRetry={refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {loading && !loaded ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !adapters.length ? (
          <EmptyState icon={Cable} title={i18n.t("还没有适配器实例")} description={i18n.t("在插件市场安装适配器并添加账号后，它会出现在这里。")} />
        ) : (
          <Table aria-label={i18n.t("适配器")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("实例")}</TableHead>
                <TableHead numeric>{i18n.t("账号")}</TableHead>
                <TableHead numeric>{i18n.t("在线")}</TableHead>
                <TableHead><span className="sr-only">{i18n.t("打开")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adapters.map(item => (
                <TableRow key={item.adapter}>
                  <TableCell><Link to={adapterHref(item.adapter)} className="font-medium hover:underline">{item.adapter}</Link></TableCell>
                  <TableCell numeric>{item.accounts}</TableCell>
                  <TableCell numeric>
                    <Badge variant={item.online === item.accounts ? 'success' : item.online ? 'warning' : 'outline'}>{item.online} / {item.accounts}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm"><Link to={adapterHref(item.adapter)} aria-label={i18n.t("打开 {0}", [item.adapter])}><ChevronRight /></Link></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageShell>
  )
}
