import { Link } from 'react-router-dom'
import { MessageSquare, MessagesSquare } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { StatusState } from '../../components/StatusState'
import { EndpointWorkspaceView } from '../endpoint-detail'
import { ConversationKindBadge } from '../features/conversation-list'
import { useConversationList } from '../features/use-feature-data'
import { ObjectPageLayout, ObjectSection, useScopeTab } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import { scopeHref, scopeKey, type Scope } from '../../scope/scope-tree.mjs'
import { ObjectFacts, ScopeFeaturesPanel, ScopeRecordsPanel } from './scope-panels'

/**
 * `/scope/:adapter/:endpoint/:conversation` (`<kind>:<id>`) — 会话: what used to be a row of the
 * workspace plus 「会话功能配置」. 聊天 opens the account workspace on this conversation.
 */
export function ConversationObjectPage({ scope }: { scope: Scope & { level: 'conversation' } }) {
  const i18n = useI18n()
  const [, selectTab] = useScopeTab(scope.level)
  // One `feature.conversations` lookup gives the display name and whether the Host has the level.
  const lookup = useConversationList({ adapter: scope.adapter, endpoint: scope.endpoint, query: scope.id })
  const key = scopeKey(scope)
  const item = key ? lookup.page?.items.find(entry => entry.key === key) : undefined
  const name = item?.name
  const levelMissing = lookup.status === 'unsupported' || lookup.status === 'forbidden'
  return (
    <ObjectPageLayout
      scope={scope}
      title={name ?? scope.id!}
      description={i18n.t('这个会话的聊天、功能与聊天角色。')}
      icon={MessagesSquare}
      platform={scope.adapter}
      names={name ? { conversation: name } : undefined}
      status={item?.hasOverrides ? <Badge variant="info" size="sm">{i18n.t('有覆盖')}</Badge> : null}
      actions={<Button variant="outline" size="sm" onClick={() => selectTab('chat')}><MessageSquare />{i18n.t('打开聊天')}</Button>}
      flushTabs={['chat']}
      panels={{
        overview: (
          <>
            <ObjectFacts items={[
              { label: i18n.t('类型'), value: <ConversationKindBadge kind={scope.kind!} /> },
              { label: i18n.t('会话 ID'), value: <code className="text-sm">{scope.id}</code> },
              { label: i18n.t('账号'), value: <Link className="underline" to={scopeHref({ adapter: scope.adapter, endpoint: scope.endpoint })}>{scope.endpoint}</Link> },
              { label: i18n.t('覆盖'), value: item ? (item.overrideCount ?? (item.hasOverrides ? '✓' : 0)) : '—' },
            ]} />
            {levelMissing ? (
              <StatusState kind={lookup.status === 'unsupported' ? 'unsupported' : 'forbidden'}
                description={lookup.status === 'unsupported' ? i18n.t('按会话配置功能需要新版 Host。当前会话使用账号的配置。') : undefined}
                permissions={lookup.status === 'forbidden' ? ['feature.view'] : undefined} />
            ) : null}
            {key === null ? (
              <StatusState kind="unsupported" title={i18n.t('这个会话不能单独配置')}
                description={i18n.t('适配器名称不是实例别名，或账号 ID 含有不支持的字符；聊天仍可使用。')} />
            ) : null}
          </>
        ),
        chat: (
          <div className="console-object-chat">
            <EndpointWorkspaceView target={{ adapter: scope.adapter!, endpointId: scope.endpoint!, channelType: scope.kind, channelId: scope.id }} />
          </div>
        ),
        features: levelMissing
          ? <StatusState kind={lookup.status === 'unsupported' ? 'unsupported' : 'forbidden'} permissions={['feature.view']}
            description={lookup.status === 'unsupported' ? i18n.t('按会话配置功能需要新版 Host。当前会话使用账号的配置。') : undefined} />
          : <ScopeFeaturesPanel scope={scope} />,
        roles: <ChatRolesPanel scope={scope} />,
        records: <ScopeRecordsPanel scope={scope} />,
      }}
    />
  )
}

/** A conversation segment that is not `<kind>:<id>`: say so and offer its account. */
export function InvalidConversationPage({ scope, segment }: { scope: Scope; segment: string }) {
  const i18n = useI18n()
  return (
    <ObjectSection title={i18n.t('会话地址无效')}>
      <StatusState kind="error" title={i18n.t('会话地址无效：{0}', [segment])}
        description={i18n.t('会话段应为「类型:ID」，类型是 group、private 或 channel。')}
        actions={<Button asChild size="sm" variant="outline"><Link to={scopeHref(scope)}>{i18n.t('返回 {0}', [scope.endpoint ?? ''])}</Link></Button>} />
    </ObjectSection>
  )
}
