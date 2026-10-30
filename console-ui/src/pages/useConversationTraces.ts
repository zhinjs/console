import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../utils/auth'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { diagnosticConversationKey } from './endpoint-detail/message-diagnostics.mjs'
import type { DiagnosticConversation } from './endpoint-detail/types'
import { isPersonalSessionKey } from './personal-models-model.mjs'
import { readTraceTurns, traceFailure, traceQuery, type TraceTurn } from './conversation-trace-model.mjs'

export function useConversationTraces(sessionKey: string, connectionScope?: string, conversation?: DiagnosticConversation) {
  const conversationKey = diagnosticConversationKey(conversation)
  const identity = JSON.stringify([connectionScope, sessionKey, conversationKey])
  const current = useRef(identity)
  current.current = identity
  const requests = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [state, setState] = useState<{ identity: string; turns: TraceTurn[]; loading: boolean; error: string | null; revision: number }>({ identity, turns: [], loading: false, error: null, revision: 0 })
  const load = useCallback(async () => {
    if (!sessionKey || (!conversationKey && !isPersonalSessionKey(sessionKey)) || !isInboxCacheScopeActive(connectionScope) || current.current !== identity) return
    const request = requests.current.begin()
    const active = () => request.current() && current.current === identity && isInboxCacheScopeActive(connectionScope)
    setState(previous => ({ identity, turns: previous.identity === identity ? previous.turns : [], loading: true, error: null, revision: previous.revision }))
    try {
      const response = await apiFetch(traceQuery('turns', sessionKey, undefined, undefined, conversation), { signal: request.signal, cache: 'no-store' })
      if (!active()) return
      if (!response.ok) throw new Error(traceFailure(response.status))
      const body: unknown = await response.json()
      if (active()) {
        const turns = readTraceTurns(body, sessionKey, 'zh-CN', conversation)
        setState(previous => ({ identity, turns, loading: false, error: null, revision: previous.revision + 1 }))
      }
    } catch (error) {
      if (active()) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : traceFailure(0) }))
    }
  }, [identity, sessionKey, connectionScope, conversationKey])
  useEffect(() => {
    requests.current.cancel()
    setState({ identity, turns: [], loading: false, error: null, revision: 0 })
    void load()
    return () => requests.current.cancel()
  }, [identity, load])
  const active = state.identity === identity && isInboxCacheScopeActive(connectionScope)
  return { turns: active ? state.turns : [], loading: active && state.loading, error: active ? state.error : null, revision: state.revision, refresh: load }
}
