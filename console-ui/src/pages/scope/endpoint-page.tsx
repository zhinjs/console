import { useState } from 'react'
import { Bot } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import EndpointsPage from '../endpoints'
import { EndpointWorkspaceView } from '../endpoint-detail'
import { ConversationList } from '../features/conversation-list'
import { useConversationList } from '../features/use-feature-data'
import { ObjectPageLayout, ObjectSection } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import type { Scope } from '../../scope/scope-tree.mjs'
import { ObjectFacts, ScopeFeaturesPanel, ScopeRecordsPanel, useEndpointInfo } from './scope-panels'

/**
 * `/scope/:adapter/:endpoint` — 账号: one object for what used to be 聊天账号 + 账号工作区 +
 * 「适配器 → 账号功能配置」. 概览 lists its conversations, 聊天 is the workspace, 接入 the login and
 * connection test, 功能 / 角色 / 记录 as on every level.
 */
export function EndpointObjectPage({ scope }: { scope: Scope & { level: 'endpoint' } }) {
  const i18n = useI18n()
  const adapter = scope.adapter!
  const endpoint = scope.endpoint!
  const { info, error, loaded } = useEndpointInfo(adapter, endpoint)
  const status = info
    ? <Badge variant={info.connected ? 'success' : 'outline'}>{info.connected ? i18n.t('在线') : i18n.t('离线')}</Badge>
    : loaded && error ? <Badge variant="outline">{i18n.t('状态未知')}</Badge> : null
  return (
    <ObjectPageLayout
      scope={scope}
      title={endpoint}
      description={i18n.t('账号的接入、会话、功能与聊天角色。')}
      icon={Bot}
      platform={adapter}
      status={status}
      flushTabs={['chat']}
      panels={{
        overview: <EndpointOverview scope={scope} info={info} error={error} loaded={loaded} />,
        chat: <div className="console-object-chat"><EndpointWorkspaceView target={{ adapter, endpointId: endpoint }} /></div>,
        access: <EndpointsPage embedded adapter={adapter} endpoint={endpoint} />,
        features: <ScopeFeaturesPanel scope={scope} />,
        roles: <ChatRolesPanel scope={scope} />,
        records: <ScopeRecordsPanel scope={scope} />,
      }}
    />
  )
}

function EndpointOverview({ scope, info, error, loaded }: { scope: Scope; info: ReturnType<typeof useEndpointInfo>['info']; error: unknown; loaded: boolean }) {
  const i18n = useI18n()
  const [query, setQuery] = useState('')
  const conversations = useConversationList({ adapter: scope.adapter, endpoint: scope.endpoint, query })
  return (
    <>
      {loaded && error ? <StatusState compact error={error} description={i18n.t('读取账号状态失败，下面的会话与配置仍可查看。')} /> : null}
      {info ? (
        <ObjectFacts items={[
          { label: i18n.t('账号'), value: info.name },
          { label: i18n.t('适配器'), value: info.adapter },
          { label: i18n.t('状态'), value: <Badge variant={info.connected ? 'success' : 'outline'}>{info.connected ? i18n.t('在线') : i18n.t('离线')}</Badge> },
          { label: i18n.t('待处理'), value: (info.pendingRequestCount ?? 0) + (info.pendingNoticeCount ?? 0) },
        ]} />
      ) : !loaded ? <Skeleton className="h-20" /> : null}
      <ObjectSection title={i18n.t('会话')} description={i18n.t('点会话进入它的对象页：聊天、功能与角色。')}>
        {conversations.status === 'unsupported' || conversations.status === 'forbidden' ? (
          <StatusState kind={conversations.status === 'unsupported' ? 'unsupported' : 'forbidden'}
            description={conversations.status === 'unsupported' ? i18n.t('按会话配置功能需要新版 Host。会话仍可在「聊天」页签中查看。') : undefined}
            permissions={conversations.status === 'forbidden' ? ['feature.view'] : undefined} />
        ) : (
          <ConversationList adapter={scope.adapter!} endpoint={scope.endpoint!} list={conversations} query={query} onQueryChange={setQuery} />
        )}
      </ObjectSection>
    </>
  )
}
