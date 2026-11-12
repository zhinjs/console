import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Info, MessageSquare } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Card, CardContent } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { ErrorAlert } from '../../components/error-alert'
import { adapterHref, endpointWorkspaceHref } from '../../console-routes.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { endpointAddress } from '../endpoint-detail/endpoint-request.mjs'
import { readEndpointList } from '../endpoint-list-model.mjs'
import { useConversationList, type EndpointSummaryItem } from './use-feature-data'
import { FeatureLevelPanel, FeatureReadOnlyNote } from './feature-level-panel'
import { ConversationList } from './conversation-list'
import { FeatureAdminsSection } from './feature-admins'

export default function EndpointFeaturesPage() {
  const { adapter = '', endpoint = '' } = useParams<{ adapter: string; endpoint: string }>()
  return <EndpointFeatures key={`${adapter}\u0000${endpoint}`} adapter={adapter} endpoint={endpoint} />
}

function EndpointFeatures({ adapter, endpoint }: { adapter: string; endpoint: string }) {
  const i18n = useI18n()
  const [info, setInfo] = useState<EndpointSummaryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    requestConsole<unknown>({ type: ENDPOINT_RPC.INFO, ...endpointAddress(adapter, endpoint) }).then(
      data => { if (!cancelled) setInfo(readEndpointList({ endpoints: [data] }, i18n.locale)[0] ?? null) },
      (err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) },
    )
    return () => { cancelled = true }
  }, [adapter, endpoint, i18n.locale])
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const conversations = useConversationList({ adapter, endpoint, query })
  // Older Hosts have no conversation level (ADR 0055): no tab, only a hint.
  const conversationsAvailable = conversations.status !== 'unsupported' && conversations.status !== 'forbidden'
  const tab = conversationsAvailable && searchParams.get('tab') === 'conversations' ? 'conversations' : 'features'
  const selectTab = useCallback((next: string) => {
    setSearchParams(previous => {
      const params = new URLSearchParams(previous)
      if (next === 'conversations') params.set('tab', 'conversations'); else params.delete('tab')
      return params
    }, { replace: true })
  }, [setSearchParams])
  const panel = <FeatureLevelPanel level="endpoint" levelKey={`${adapter}/${endpoint}`} adapter={adapter} endpoint={endpoint} />
  return (
    <PageShell>
      <div><Button asChild variant="ghost" size="sm"><Link to={adapterHref(adapter)}><ArrowLeft />{i18n.t("返回 {0}", [adapter])}</Link></Button></div>
      <PageHeader
        title={i18n.t("账号功能配置")}
        description={i18n.t("{0} · {1}", [adapter, endpoint])}
        actions={<Button asChild variant="outline" size="sm"><Link to={endpointWorkspaceHref(adapter, endpoint)}><MessageSquare />{i18n.t("账号工作区")}</Link></Button>}
      />
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
      <FeatureReadOnlyNote />
      {conversationsAvailable ? (
        <Tabs value={tab} onValueChange={selectTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="features">{i18n.t("功能")}</TabsTrigger>
            <TabsTrigger value="conversations">{i18n.t("会话")}</TabsTrigger>
          </TabsList>
          <TabsContent value="features" className="mt-0">{panel}</TabsContent>
          <TabsContent value="conversations" className="mt-0">
            <ConversationList adapter={adapter} endpoint={endpoint} list={conversations} query={query} onQueryChange={setQuery} />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {conversations.status === 'unsupported' ? (
            <Alert role="status"><Info className="h-4 w-4" /><AlertDescription>{i18n.t("按会话配置功能需要新版 Host。")}</AlertDescription></Alert>
          ) : null}
          {panel}
        </>
      )}
      <FeatureAdminsSection level="endpoint" levelKey={`${adapter}/${endpoint}`} />
    </PageShell>
  )
}
