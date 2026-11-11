import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { ErrorAlert } from '../../components/error-alert'
import { adapterHref, endpointWorkspaceHref } from '../../console-routes.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { endpointAddress } from '../endpoint-detail/endpoint-request.mjs'
import { readEndpointList } from '../endpoint-list-model.mjs'
import { useFeatureRpcProbe, type EndpointSummaryItem } from './use-feature-data'
import { FeatureOverridesNotice } from './feature-overrides-notice'

export default function EndpointFeaturesPage() {
  const { adapter = '', endpoint = '' } = useParams<{ adapter: string; endpoint: string }>()
  return <EndpointFeatures key={`${adapter}\u0000${endpoint}`} adapter={adapter} endpoint={endpoint} />
}

function EndpointFeatures({ adapter, endpoint }: { adapter: string; endpoint: string }) {
  const i18n = useI18n()
  const [info, setInfo] = useState<EndpointSummaryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const probe = useFeatureRpcProbe('endpoint', `${adapter}/${endpoint}`)
  useEffect(() => {
    let cancelled = false
    requestConsole<unknown>({ type: ENDPOINT_RPC.INFO, ...endpointAddress(adapter, endpoint) }).then(
      data => { if (!cancelled) setInfo(readEndpointList({ endpoints: [data] }, i18n.locale)[0] ?? null) },
      (err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) },
    )
    return () => { cancelled = true }
  }, [adapter, endpoint, i18n.locale])
  return (
    <PageShell>
      <div><Button asChild variant="ghost" size="sm"><Link to={adapterHref(adapter)}><ArrowLeft />{i18n.t("返回 {0}", [adapter])}</Link></Button></div>
      <PageHeader
        title={i18n.t("账号功能配置")}
        description={i18n.t("{0} · {1}", [adapter, endpoint])}
        actions={<Button asChild variant="outline" size="sm"><Link to={endpointWorkspaceHref(adapter, endpoint)}><MessageSquare />{i18n.t("账号工作区")}</Link></Button>}
      />
      <FeatureOverridesNotice status={probe} level="endpoint" />
      {error ? <ErrorAlert error={error} /> : null}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          {info ? <>
            <div><p className="text-xs text-muted-foreground">{i18n.t("账号")}</p><p className="font-medium">{info.name}</p></div>
            <div><p className="text-xs text-muted-foreground">{i18n.t("适配器")}</p><p className="font-medium">{info.adapter}</p></div>
            <div><p className="text-xs text-muted-foreground">{i18n.t("状态")}</p><Badge variant={info.connected ? 'success' : 'outline'}>{info.connected ? i18n.t("在线") : i18n.t("离线")}</Badge></div>
          </> : error ? null : <><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></>}
        </CardContent>
      </Card>
    </PageShell>
  )
}
