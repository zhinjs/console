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
}

/** Mounted only when the Sandbox asks its Console shell for conversation details. */
export function SandboxConversationDetails({ sessionKey, canExecute }: SandboxConversationContext) {
  if (!canExecute || isDemoMode()) return null
  return <ScopedConversationDetails sessionKey={sessionKey} />
}

function ScopedConversationDetails({ sessionKey }: { sessionKey: string }) {
  const scope = useInboxCacheScope()
  if (!isInboxCacheScopeActive(scope)) return null
  // Changing the Host, credentials or scene retires the underlying readers and their requests.
  return <ConversationReader key={JSON.stringify([scope, sessionKey])} sessionKey={sessionKey} connectionScope={scope} />
}

function ConversationReader({ sessionKey, connectionScope }: { sessionKey: string; connectionScope?: string }) {
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
      <ConversationHistory sessionKey={sessionKey} connectionScope={connectionScope} turns={traces.turns}
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
