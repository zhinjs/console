import { Bot } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { EndpointWorkspaceView } from '../endpoint-detail'
import { ObjectPageLayout, useScopeTab } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import type { Scope } from '../../scope/scope-tree.mjs'
import { EndpointAccessPanel } from './endpoint-access'
import { useEndpointsAndLogin, WaitingLoginBadge } from './login-tasks'
import { EndpointOverview } from './overview-panels'
import { endpointAccessState, loginTasksFor } from './scope-overview-model.mjs'
import { ScopeFeaturesPanel, ScopeRecordsPanel, useEndpointInfo } from './scope-panels'

/**
 * `/scope/:adapter/:endpoint` — 账号: one object for what used to be 聊天账号 + 账号工作区 +
 * 「适配器 → 账号功能配置」. 概览 is its information card and a summary of its conversations, 聊天
 * the workspace (full conversation list), 接入 the connection, login and configuration links.
 */
export function EndpointObjectPage({ scope }: { scope: Scope & { level: 'endpoint' } }) {
  const i18n = useI18n()
  const adapter = scope.adapter!
  const endpoint = scope.endpoint!
  const [, selectTab] = useScopeTab(scope.level)
  const endpointInfo = useEndpointInfo(adapter, endpoint)
  const data = useEndpointsAndLogin()
  const { info, error, loaded } = endpointInfo
  const waiting = loginTasksFor(data.tasks, adapter, endpoint).length
  // endpoint.list decides whether the Host runs the account at all; endpoint.info adds its details.
  const listed = endpointAccessState(data, adapter, endpoint)
  const connected = listed.kind === 'listed' ? listed.endpoint.connected : info?.connected
  const status = <>
    {listed.kind === 'unlisted' ? <Badge variant="outline">{i18n.t('未运行')}</Badge>
      : connected !== undefined ? <Badge variant={connected ? 'success' : 'outline'}>{connected ? i18n.t('在线') : i18n.t('离线')}</Badge>
        : loaded && error ? <Badge variant="outline">{i18n.t('状态未知')}</Badge> : null}
    {waiting ? <WaitingLoginBadge /> : null}
  </>
  return (
    <ObjectPageLayout
      scope={scope}
      title={endpoint}
      description={i18n.t('账号的接入、会话、功能与聊天角色。')}
      icon={Bot}
      platform={adapter}
      status={status}
      flushTabs={['chat']}
      badges={{ access: waiting || undefined }}
      panels={{
        overview: <EndpointOverview scope={scope} endpointInfo={endpointInfo} onOpenTab={selectTab} />,
        chat: <div className="console-object-chat"><EndpointWorkspaceView target={{ adapter, endpointId: endpoint }} /></div>,
        access: <EndpointAccessPanel scope={scope} data={data} />,
        features: <ScopeFeaturesPanel scope={scope} />,
        roles: <ChatRolesPanel scope={scope} />,
        records: <ScopeRecordsPanel scope={scope} />,
      }}
    />
  )
}
