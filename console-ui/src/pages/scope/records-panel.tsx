import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, BrainCircuit, FileText, MessageSquare, MessagesSquare, type LucideIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { apiFetch } from '../../utils/auth'
import { agentSessionsPath, parseImSessionKey, SESSION_SCOPE_LABELS } from '../../utils/agent-session'
import { isPersonalSessionKey } from '../personal-session-model.mjs'
import { readRecentSessions, relativeSince, type RecentSession } from '../agent-session-recent.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { scopeHref, scopeLevel, type Scope } from '../../scope/scope-tree.mjs'
import {
  ASSOCIATION_LABELS, RECORD_SOURCE_COPY, recordSources, sessionConversationScope, sessionKeyInScope,
  type RecordAssociation, type RecordSourceId,
} from './records-model.mjs'
import './records-panel.css'

/** Host trace archive: every session the Agent has worked in (the same source as 聊天记录). */
const RECENT_SESSIONS_PATH = '/api/agent/trace-archive/sessions'
const SESSION_LIMIT = 8

const SOURCE_ICONS: Record<RecordSourceId, LucideIcon> = { sessions: MessagesSquare, replay: BrainCircuit, logs: FileText, audit: Activity }
const ASSOCIATION_VARIANT: Record<RecordAssociation, 'success' | 'warning' | 'outline' | 'secondary'> = { exact: 'success', partial: 'warning', page: 'outline', all: 'secondary' }

type SessionsState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; rows: RecentSession[]; total: number }

/** Sessions of the scope, matched by their key (`<platform>:<endpoint>:<kind>:<id>`), newest first. */
function useScopeSessions(scope: Scope): SessionsState {
  const [state, setState] = useState<SessionsState>({ status: 'loading' })
  const identity = JSON.stringify([scope.level, scope.adapter, scope.endpoint, scope.kind, scope.id])
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    apiFetch(RECENT_SESSIONS_PATH, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body: unknown = await response.json()
        const all = readRecentSessions(body, Number.POSITIVE_INFINITY).filter(row => sessionKeyInScope(row.sessionKey, scope))
        if (active) setState({ status: 'ready', rows: all.slice(0, SESSION_LIMIT), total: all.length })
      })
      .catch((error: unknown) => { if (active) setState({ status: 'error', error }) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
  return state
}

function SessionRow({ row, showAccount }: { row: RecentSession; showAccount: boolean }) {
  const i18n = useI18n()
  const parsed = parseImSessionKey(row.sessionKey)
  const conversation = sessionConversationScope(row.sessionKey)
  const personal = isPersonalSessionKey(row.sessionKey)
  return (
    <li className="console-records-session">
      <div className="console-records-session-main">
        <Link className="console-records-session-name" to={agentSessionsPath(row.sessionKey)} title={row.sessionKey}>
          {parsed ? parsed.sceneId : personal ? i18n.t('个人会话') : row.sessionKey}
        </Link>
        <p className="console-records-session-meta">
          {parsed ? <span>{i18n.t(SESSION_SCOPE_LABELS[parsed.scope])}</span> : null}
          {parsed && showAccount ? <code>{parsed.endpointId}</code> : null}
          <span>{i18n.t('{0} 轮', [row.turns])}</span>
          <span>{relativeSince(row.lastAt, Date.now(), i18n.locale)}</span>
          {row.lastStatus === 'failed' || row.lastStatus === 'error' ? <Badge variant="destructive" size="sm">{i18n.t('最后一轮出错')}</Badge> : null}
        </p>
      </div>
      {conversation ? (
        <Button asChild variant="ghost" size="sm" className="console-records-session-action">
          <Link to={scopeHref(conversation, 'chat')}><MessageSquare />{i18n.t('继续聊天')}</Link>
        </Button>
      ) : <span className="console-records-session-note">{i18n.t('仅可查看')}</span>}
    </li>
  )
}

/**
 * 记录 tab (all four levels): the scope's own Agent sessions, embedded, and the record pages opened
 * already narrowed to the scope. Each source says how exact that narrowing is; records without an
 * identity field are never matched by time.
 */
export function ScopeRecordsPanel({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const level = scopeLevel(scope)
  const sessions = useScopeSessions(scope)
  const sources = recordSources(scope)
  const sessionsLink = sources.find(source => source.id === 'sessions')!
  return (
    <>
      <ObjectSection
        title={i18n.t('聊天记录')}
        description={level === 'conversation' ? i18n.t('这个会话的 Agent 会话：对话、轨迹与分支。') : level === 'global' ? i18n.t('最近活跃的 Agent 会话。') : i18n.t('属于这个范围的 Agent 会话，按会话标识匹配。')}
        actions={<Button asChild variant="outline" size="sm"><Link to={sessionsLink.href}><ArrowUpRight />{i18n.t('在聊天记录中打开')}</Link></Button>}
      >
        <Card className="overflow-hidden p-0">
          {sessions.status === 'loading' ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-10" />)}</div>
          ) : sessions.status === 'error' ? (
            <StatusState compact error={sessions.error} permissions={['status.view']} />
          ) : sessions.rows.length === 0 ? (
            <StatusState compact kind="empty" title={i18n.t('还没有聊天记录')}
              description={i18n.t('机器人在这个范围里处理过消息后，会话会出现在这里。')} />
          ) : (
            <>
              <ul className="console-records-sessions">
                {sessions.rows.map(row => <SessionRow key={row.sessionKey} row={row} showAccount={level === 'global' || level === 'adapter'} />)}
              </ul>
              {sessions.total > sessions.rows.length ? (
                <p className="console-records-more">{i18n.t('还有 {0} 个会话，在聊天记录中查看全部。', [sessions.total - sessions.rows.length])}</p>
              ) : null}
            </>
          )}
        </Card>
      </ObjectSection>

      <ObjectSection title={i18n.t('其他记录')} description={i18n.t('打开时已按这个范围筛选。标签说明筛选有多精确。')}>
        <ul className="console-records-sources">
          {sources.filter(source => source.id !== 'sessions').map(source => {
            const Icon = SOURCE_ICONS[source.id]
            const copy = RECORD_SOURCE_COPY[source.id]
            return (
              <li key={source.id}>
                <Card className="console-records-source">
                  <div className="console-records-source-head">
                    <span className="console-records-source-icon" aria-hidden><Icon /></span>
                    <h3>{i18n.t(copy.title)}</h3>
                    <Badge variant={ASSOCIATION_VARIANT[source.association]} size="sm">{i18n.t(ASSOCIATION_LABELS[source.association])}</Badge>
                  </div>
                  <p className="console-records-source-description">{i18n.t(copy.description)}</p>
                  <p className="console-records-source-note">{i18n.t(source.note)}</p>
                  {source.filter ? <p className="console-records-source-filter">{i18n.t('筛选：')}<code title={source.filter}>{source.filter}</code></p> : null}
                  <Button asChild variant="outline" size="sm" className="console-records-source-open">
                    <Link to={source.href}>{i18n.t('打开{0}', [i18n.t(copy.title)])}<ArrowUpRight /></Link>
                  </Button>
                </Card>
              </li>
            )
          })}
        </ul>
      </ObjectSection>
    </>
  )
}
