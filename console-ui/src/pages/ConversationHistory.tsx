import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { ErrorAlert } from '../components/error-alert'
import { apiFetch } from '../utils/auth'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { MessageBody } from './endpoint-detail/MessageBody'
import { ConversationUsage } from './ConversationUsage'
import { turnsForMessage, type TraceTurn } from './conversation-trace-model.mjs'
import type { DiagnosticConversation } from './endpoint-detail/types'
import {
  conversationHistoryQuery, conversationHistoryFailure, readConversationHistory, prependConversationHistory,
  type ConversationHistoryFailure, type ConversationHistoryPage,
} from './conversation-history-model.mjs'

interface HistoryState {
  sessionKey: string
  connectionScope?: string
  connectionId?: string
  page: ConversationHistoryPage | null
  loading: boolean
  error: (ConversationHistoryFailure & { mode: 'latest' | 'earlier' }) | null
}

export function ConversationHistory({ sessionKey, connectionScope, connectionId, turns = [], onOpenTrace, onRefresh, onConversation }: {
  sessionKey: string; connectionScope?: string; connectionId?: string; turns?: TraceTurn[]; onOpenTrace?: (turnId: string) => void; onRefresh?: () => void
  onConversation?: (conversation: DiagnosticConversation | undefined, error?: string, retry?: () => void) => void
}) {
  const i18n = useI18n()
  const [state, setState] = useState<HistoryState>({ sessionKey, connectionScope, connectionId, page: null, loading: false, error: null })
  const current = useRef({ sessionKey, connectionScope, connectionId })
  current.current = { sessionKey, connectionScope, connectionId }
  const latest = useRef(state)
  latest.current = state
  const requests = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const inFlight = useRef(false)
  const reportConversation = useRef(onConversation)
  reportConversation.current = onConversation
  const load = useCallback(async (mode: 'latest' | 'earlier' = 'latest') => {
    if (!isInboxCacheScopeActive(connectionScope) || current.current.sessionKey !== sessionKey
      || current.current.connectionScope !== connectionScope || current.current.connectionId !== connectionId || inFlight.current) return
    const previous = latest.current.sessionKey === sessionKey && latest.current.connectionScope === connectionScope && latest.current.connectionId === connectionId
      ? latest.current : { sessionKey, connectionScope, connectionId, page: null, loading: false, error: null }
    if (mode === 'earlier' && !previous.page?.hasMore) return
    const before = mode === 'earlier' ? previous.page?.nextBeforeSequence ?? undefined : undefined
    const request = requests.current.begin()
    const active = () => request.current() && isInboxCacheScopeActive(connectionScope)
      && current.current.sessionKey === sessionKey && current.current.connectionScope === connectionScope && current.current.connectionId === connectionId
    inFlight.current = true
    setState({ ...previous, loading: true, error: null })
    try {
      const response = await apiFetch(conversationHistoryQuery(sessionKey, before, connectionId), { signal: request.signal, cache: 'no-store' })
      if (!active()) return
      let body: unknown
      try { body = await response.json() }
      catch { if (response.ok) throw new Error('聊天记录响应格式不正确。') }
      if (!active()) return
      if (!response.ok) {
        const failure = conversationHistoryFailure(response.status, body)
        reportConversation.current?.(undefined, failure.message, () => void load('latest'))
        setState({ ...previous, loading: false, error: { ...failure, mode } })
        return
      }
      const page = readConversationHistory(body, previous.page?.conversation, before)
      reportConversation.current?.(page.conversation)
      setState({ sessionKey, connectionScope, connectionId, page: mode === 'earlier' ? prependConversationHistory(previous.page, page) : page, loading: false, error: null })
    } catch (cause) {
      if (active()) {
        const message = cause instanceof Error ? cause.message : '聊天记录读取失败。'
        reportConversation.current?.(undefined, message, () => void load('latest'))
        setState({ ...previous, loading: false, error: { kind: 'other', message, mode } })
      }
    } finally { if (active()) inFlight.current = false }
  }, [sessionKey, connectionScope, connectionId])

  useEffect(() => {
    requests.current.cancel()
    inFlight.current = false
    latest.current = { sessionKey, connectionScope, connectionId, page: null, loading: false, error: null }
    setState(latest.current)
    void load()
    return () => { requests.current.cancel(); inFlight.current = false }
  }, [load])

  if (!isInboxCacheScopeActive(connectionScope) || state.sessionKey !== sessionKey || state.connectionScope !== connectionScope || state.connectionId !== connectionId) return null
  const page = state.page
  const items = page?.items.filter(item => item.type === 'message.created' || item.type === 'message.recalled') ?? []
  const recalled = new Set(page?.items.filter(item => item.type === 'message.recalled' && item.messageRef).map(item => item.messageRef!.id))
  const dateFormat = new Intl.DateTimeFormat(i18n.locale, { year: 'numeric', month: 'long', day: 'numeric' })
  const timeFormat = new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' })
  let lastDay = ''
  return <section className="conversation-history" aria-label={i18n.t('聊天记录')}>
    <div className="conversation-history-navigation">
      <Button variant="ghost" size="sm" disabled={state.loading} onClick={() => { void load('latest'); onRefresh?.() }}>{i18n.t('刷新')}</Button>
      {page?.hasMore ? <Button variant="ghost" size="sm" disabled={state.loading} onClick={() => void load('earlier')}>{state.loading ? i18n.t('加载中…') : i18n.t('加载更早记录')}</Button>
        : state.loading ? <p role="status">{i18n.t('加载中…')}</p> : null}
    </div>
    {state.error ? <ErrorAlert kind={state.error.kind} error={i18n.t(state.error.message)} onRetry={() => void load(state.error!.mode)} /> : null}
    {page && !items.length ? <p className="conversation-history-empty" role="status">{i18n.t('当前记录中没有聊天消息。')}</p> : null}
    <div className="conversation-history-list">
      {items.map(item => {
        const message = item.message
        const timestamp = message?.timestamp ?? item.timestamp
        const day = new Date(timestamp).toDateString()
        const showDay = day !== lastDay
        lastDay = day
        const outgoing = item.type === 'message.created' && !message?.actor
        return <Fragment key={item.sequence}>
          {showDay ? <p className="conversation-date">{dateFormat.format(timestamp)}</p> : null}
          {item.type === 'message.recalled' ? <p className="conversation-system-message"><time dateTime={new Date(timestamp).toISOString()}>{timeFormat.format(timestamp)}</time>{' '}{i18n.t('消息已撤回')}</p>
            : message ? <article className={`conversation-message${outgoing ? ' conversation-message-outgoing' : ''}`}>
              <header className="conversation-message-meta">
                <span>{message.actor ? message.actor.displayName || message.actor.id : i18n.t('当前机器人')}</span>
                <time dateTime={new Date(timestamp).toISOString()}>{timeFormat.format(timestamp)}</time>
                {recalled.has(message.ref.id) ? <span className="conversation-message-recalled">{i18n.t('已撤回')}</span> : null}
              </header>
              <div className="conversation-message-body">{message.contentStatus === 'unavailable'
                ? <p>{i18n.t('消息正文未保存')}</p> : <MessageBody content={message.segments} />}</div>
              {message.actor ? <ConversationUsage turns={turnsForMessage(turns, message.ref)} onOpenTrace={onOpenTrace} /> : null}
            </article> : null}
        </Fragment>
      })}
    </div>
  </section>
}
