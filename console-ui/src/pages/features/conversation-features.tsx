import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { ErrorAlert } from '../../components/error-alert'
import { endpointConversationsHref } from '../../console-routes.mjs'
import { conversationKey, parseConversationSegment, type ConversationKind } from './feature-model.mjs'
import { useConversationList } from './use-feature-data'
import { FeatureLevelPanel, FeatureReadOnlyNote } from './feature-level-panel'
import { FeatureOverridesNotice } from './feature-overrides-notice'
import { ConversationKindBadge } from './conversation-list'

/** `/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation` (ADR 0055 §6). */
export default function ConversationFeaturesPage() {
  const { adapter = '', endpoint = '', conversation = '' } = useParams<{ adapter: string; endpoint: string; conversation: string }>()
  return <ConversationFeatures key={`${adapter}\u0000${endpoint}\u0000${conversation}`} adapter={adapter} endpoint={endpoint} segment={conversation} />
}

function ConversationFeatures({ adapter, endpoint, segment }: { adapter: string; endpoint: string; segment: string }) {
  const i18n = useI18n()
  const parsed = parseConversationSegment(segment)
  let key: string | null = null
  try {
    key = parsed ? conversationKey({ adapter, endpoint, kind: parsed.kind, id: parsed.id }) : null
  } catch {
    key = null
  }
  const back = (
    <div><Button asChild variant="ghost" size="sm"><Link to={endpointConversationsHref(adapter, endpoint)}><ArrowLeft />{i18n.t("返回 {0}", [endpoint])}</Link></Button></div>
  )
  if (!parsed || !key) {
    return (
      <PageShell>
        {back}
        <ErrorAlert error={i18n.t("会话地址无效：{0}", [segment])} />
      </PageShell>
    )
  }
  return <ConversationDetail adapter={adapter} endpoint={endpoint} kind={parsed.kind} id={parsed.id} conversationKey={key} back={back} />
}

interface ConversationDetailProps {
  readonly adapter: string
  readonly endpoint: string
  readonly kind: ConversationKind
  readonly id: string
  readonly conversationKey: string
  readonly back: ReactNode
}

function ConversationDetail({ adapter, endpoint, kind, id, conversationKey: key, back }: ConversationDetailProps) {
  const i18n = useI18n()
  // Also the capability probe: an older Host does not know `feature.conversations`.
  const lookup = useConversationList({ adapter, endpoint, query: id })
  const item = lookup.page?.items.find(entry => entry.key === key)
  const name = item?.name
  return (
    <PageShell>
      {back}
      <PageHeader title={name ?? id} description={i18n.t("{0} · {1} · 会话功能配置", [adapter, endpoint])} />
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">{i18n.t("类型")}</p><ConversationKindBadge kind={kind} /></div>
          <div><p className="text-xs text-muted-foreground">{i18n.t("会话 ID")}</p><code className="break-all text-sm">{id}</code></div>
          <div><p className="text-xs text-muted-foreground">{i18n.t("账号")}</p><p className="font-medium">{endpoint}</p></div>
        </CardContent>
      </Card>
      {lookup.status === 'unsupported' || lookup.status === 'forbidden' ? (
        <FeatureOverridesNotice status={lookup.status} level="conversation" />
      ) : (
        <>
          <FeatureReadOnlyNote />
          <FeatureLevelPanel level="conversation" levelKey={key} adapter={adapter} endpoint={endpoint} />
        </>
      )}
    </PageShell>
  )
}
