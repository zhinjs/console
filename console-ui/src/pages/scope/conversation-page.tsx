import { Link } from 'react-router-dom'
import { MessageSquare, MessagesSquare, Radio } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { StatusState } from '../../components/StatusState'
import { ConversationChatPanel } from './chat-panels'
import { useConversationList } from '../features/use-feature-data'
import { ObjectPageLayout, ObjectSection, useScopeTab } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import { scopeHref, scopeKey, type Scope } from '../../scope/scope-tree.mjs'
import { ConversationOverview } from './overview-panels'
import { ambientSettingsHref } from './scope-overview-model.mjs'
import { ScopeFeaturesPanel, ScopeRecordsPanel } from './scope-panels'

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
  // Private chats have no ambient (群聊插话) settings.
  const ambient = ambientSettingsHref(scope)
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
      actions={<>
        <Button variant="outline" size="sm" onClick={() => selectTab('chat')}><MessageSquare />{i18n.t('打开聊天')}</Button>
        {ambient ? <Button asChild variant="outline" size="sm"><Link to={ambient}><Radio />{i18n.t('群聊插话设置')}</Link></Button> : null}
      </>}
      flushTabs={['chat']}
      panels={{
        overview: <ConversationOverview scope={scope} item={item} levelMissing={levelMissing ? (lookup.status as 'unsupported' | 'forbidden') : null} />,
        chat: <ConversationChatPanel scope={scope} />,
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
