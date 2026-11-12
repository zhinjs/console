import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare, RefreshCw, SlidersHorizontal, UserRound } from 'lucide-react'
import { AdapterConsolePage } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { adapterEndpointHref, endpointWorkspaceHref } from '../../console-routes.mjs'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { endpointsOfAdapter } from './feature-model.mjs'
import { useEndpointList, useFeatureMatrix } from './use-feature-data'
import { FeatureLevelPanel, FeatureReadOnlyNote } from './feature-level-panel'
import { FeatureAdminsSection } from './feature-admins'

export default function AdapterDetailPage() {
  const { adapter = '' } = useParams<{ adapter: string }>()
  return <AdapterDetail key={adapter} adapter={adapter} />
}

function AdapterDetail({ adapter }: { adapter: string }) {
  const i18n = useI18n()
  const { endpoints, loading, loaded, error, refresh } = useEndpointList()
  const accounts = endpointsOfAdapter(endpoints, adapter)
  const matrix = useFeatureMatrix()
  // Endpoint ids the Host knows for this alias (configuration and stored overrides).
  const knownEndpoints = (matrix.endpoints[adapter] ?? []).filter(id => !accounts.some(account => account.name === id))
  return (
    <PageShell>
      <div><Button asChild variant="ghost" size="sm"><Link to="/features/adapters"><ArrowLeft />{i18n.t("全部适配器")}</Link></Button></div>
      <PageHeader
        title={adapter}
        description={i18n.t("该适配器下的功能覆盖与账号连接。")}
        actions={<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
      />
      {error ? <ErrorAlert error={error} onRetry={refresh} /> : null}
      <FeatureReadOnlyNote />
      <FeatureLevelPanel level="adapter" levelKey={adapter} adapter={adapter} />
      <FeatureAdminsSection level="adapter" levelKey={adapter} />
      <section aria-labelledby="adapter-accounts" className="space-y-3">
        <h2 id="adapter-accounts" className="text-base font-semibold">{i18n.t("账号")}</h2>
        <Card className="overflow-hidden p-0">
          {loading && !loaded ? (
            <div className="space-y-2 p-4">{[0, 1].map(index => <Skeleton key={index} className="h-9" />)}</div>
          ) : !accounts.length ? (
            <EmptyState icon={UserRound} compact title={i18n.t("这个适配器还没有账号")} description={loaded ? i18n.t("在下方的连接管理里添加账号。") : undefined} />
          ) : (
            <Table aria-label={i18n.t("账号")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t("账号")}</TableHead>
                  <TableHead>{i18n.t("状态")}</TableHead>
                  <TableHead className="text-right">{i18n.t("操作")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(account => (
                  <TableRow key={account.name}>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell><Badge variant={account.connected ? 'success' : 'outline'}>{account.connected ? i18n.t("在线") : i18n.t("离线")}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        <Button asChild variant="outline" size="sm"><Link to={endpointWorkspaceHref(adapter, account.name)}><MessageSquare />{i18n.t("账号工作区")}</Link></Button>
                        <Button asChild variant="outline" size="sm"><Link to={adapterEndpointHref(adapter, account.name)}><SlidersHorizontal />{i18n.t("功能配置")}</Link></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {knownEndpoints.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{i18n.t("配置中的其他账号：")}</span>
            {knownEndpoints.map(id => (
              <Button key={id} asChild variant="outline" size="sm"><Link to={adapterEndpointHref(adapter, id)}><SlidersHorizontal />{id}</Link></Button>
            ))}
          </div>
        ) : null}
      </section>
      {hasConsolePermission('endpoint.manage') ? (
        <section aria-labelledby="adapter-connections" className="space-y-3">
          <h2 id="adapter-connections" className="text-base font-semibold">{i18n.t("连接管理")}</h2>
          <AdapterConsolePage adapterKey={adapter} />
        </section>
      ) : (
        <Alert role="status"><AlertDescription>{i18n.t("当前身份不能管理账号连接。")}</AlertDescription></Alert>
      )}
    </PageShell>
  )
}
