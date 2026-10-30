import { useState } from 'react'
import { useI18n } from '../i18n'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { isDemoMode } from '../utils/demo-mode'
import { ConversationHistory } from './ConversationHistory'
import { ConversationTrace } from './ConversationTrace'
import { useConversationTraces } from './useConversationTraces'
import type { DiagnosticConversation } from './endpoint-detail/types'
import './conversation-trace.css'
import './agent-sessions.css'

export interface SandboxConversationContext {
  readonly sessionKey: string
  readonly canExecute: boolean
  readonly connectionId?: string
}

/** Mounted only when the Sandbox asks its Console shell for conversation details. */
export function SandboxConversationDetails({ sessionKey, canExecute, connectionId }: SandboxConversationContext) {
  if (!canExecute || isDemoMode()) return null
  return <ScopedConversationDetails sessionKey={sessionKey} connectionId={connectionId} />
}

function ScopedConversationDetails({ sessionKey, connectionId }: { sessionKey: string; connectionId?: string }) {
  const scope = useInboxCacheScope()
  if (!isInboxCacheScopeActive(scope)) return null
  // A new connection also retires the previously resolved canonical address.
  return <ConversationReader key={JSON.stringify([scope, sessionKey, connectionId])} sessionKey={sessionKey} connectionScope={scope} connectionId={connectionId} />
}

function ConversationReader({ sessionKey, connectionScope, connectionId }: { sessionKey: string; connectionScope?: string; connectionId?: string }) {
  const i18n = useI18n()
  const [view, setView] = useState('conversation')
  const [resolved, setResolved] = useState<{
    conversation?: DiagnosticConversation
    error?: string
    retry?: () => void
  } | null>(null)
  const [selectedTurn, setSelectedTurn] = useState('')
  const traces = useConversationTraces(sessionKey, connectionScope, resolved?.conversation)

  return <Tabs value={view} onValueChange={setView}>
    <TabsList aria-label={i18n.t('记录视图')}>
      <TabsTrigger value="conversation">{i18n.t('对话')}</TabsTrigger>
      <TabsTrigger value="trace">{i18n.t('轨迹')}</TabsTrigger>
    </TabsList>
    <TabsContent value="conversation" forceMount className="data-[state=inactive]:hidden">
      <ConversationHistory sessionKey={sessionKey} connectionScope={connectionScope} connectionId={connectionId} turns={traces.turns}
        onRefresh={traces.refresh}
        onOpenTrace={turnId => { setSelectedTurn(turnId); setView('trace') }}
        onConversation={(conversation, error, retry) => setResolved({ conversation, error, retry })} />
    </TabsContent>
    <TabsContent value="trace">
      <ConversationTrace turns={traces.turns} revision={traces.revision}
        loading={!resolved?.conversation && !resolved?.error || traces.loading}
        error={resolved?.error ?? traces.error}
        refresh={() => {
          if (resolved?.conversation) void traces.refresh()
          else if (resolved?.retry) { setResolved(null); resolved.retry() }
        }}
        selectedTurn={selectedTurn} onSelectTurn={setSelectedTurn}
        connectionScope={connectionScope} conversation={resolved?.conversation} />
    </TabsContent>
  </Tabs>
}
