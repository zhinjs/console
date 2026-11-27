import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, BrainCircuit, FileText, MessageSquare, MessagesSquare, type LucideIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge, Button, Card, Skeleton } from '@zhin.js/console-ui'
import { StatusState } from '../../components/StatusState'
import { apiFetch } from '../../utils/auth'
import { CONSOLE_PATHS } from '../../console-routes.mjs'
import { agentSessionsPath, parseImSessionKey, SESSION_SCOPE_LABELS } from '../../utils/agent-session'
import { isPersonalSessionKey } from '../personal-session-model.mjs'
import { relativeSince } from '../agent-session-recent.mjs'
import { usageSessionLabel } from '../token-usage-model.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { scopeHref, scopeLevel, type Scope } from '../../scope/scope-tree.mjs'
import {
  ASSOCIATION_LABELS, RECORD_SOURCE_COPY, recordSources, scopeSessionRecords,
  type RecordAssociation, type RecordSourceId, type ScopeSessionRecords, type ScopeSessionRow,
} from './records-model.mjs'
import './records-panel.css'

/** Host trace archive: every session the Agent has worked in (the same source as 聊天记录). */
const RECENT_SESSIONS_PATH = '/api/agent/trace-archive/sessions'
const SESSION_LIMIT = 8
/** Empty state when only sessions that name no account exist (authored, displayed through i18n). */
const UNATTRIBUTED_TITLES: Record<'adapter' | 'endpoint' | 'conversation', string> = {
  adapter: '没找到能对应到这个适配器的会话',
  endpoint: '没找到能对应到这个账号的会话',
  conversation: '没找到能对应到这个会话的聊天记录',
}

const SOURCE_ICONS: Record<RecordSourceId, LucideIcon> = { sessions: MessagesSquare, replay: BrainCircuit, logs: FileText, audit: Activity }
const ASSOCIATION_VARIANT: Record<RecordAssociation, 'warning' | 'outline' | 'secondary'> = { exact: 'outline', partial: 'warning', text: 'outline', all: 'secondary' }

type SessionsState = { status: 'loading' } | { status: 'error'; error: unknown } | ({ status: 'ready' } & ScopeSessionRecords)

/**
 * Sessions of the scope, newest first: matched by the origin the Host recorded, else by an old-style
 * key (`<platform>:<endpoint>:<kind>:<id>`). Hashed keys without an origin are counted, not guessed.
 */
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
        if (active) setState({ status: 'ready', ...scopeSessionRecords(body, scope, SESSION_LIMIT) })
      })
      .catch((error: unknown) => { if (active) setState({ status: 'error', error }) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
  return state
}

/** Name of a session row: the scene id of an old-style key, else the recorded origin, else a short label. */
function sessionRowName(row: ScopeSessionRow, locale: 'zh-CN' | 'en', t: (message: string) => string): string {
  const parsed = parseImSessionKey(row.sessionKey)
  if (parsed) return parsed.sceneId
  if (row.origin?.name || row.origin?.id) return row.origin.name ?? row.origin.id!
  if (isPersonalSessionKey(row.sessionKey)) return t('个人会话')
  return usageSessionLabel({ sessionKey: row.sessionKey, ...(row.origin ? { platform: row.origin.adapter } : {}) }, locale)
}

function SessionRow({ row, showAccount }: { row: ScopeSessionRow; showAccount: boolean }) {
  const i18n = useI18n()
  const parsed = parseImSessionKey(row.sessionKey)
  const conversation = row.conversation
  const kind = parsed?.scope ?? row.origin?.kind
  const account = parsed?.endpointId ?? row.origin?.endpoint
  return (
    <li className="console-records-session">
      <div className="console-records-session-main">
        <Link className="console-records-session-name" to={agentSessionsPath(row.sessionKey)} title={row.sessionKey}>
          {sessionRowName(row, i18n.locale, message => i18n.t(message))}
        </Link>
        <p className="console-records-session-meta">
          {kind ? <span>{i18n.t(SESSION_SCOPE_LABELS[kind])}</span> : null}
          {account && showAccount ? <code>{account}</code> : null}
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
        description={level === 'conversation' ? i18n.t('这个会话的 Agent 会话：对话、轨迹与分支。') : level === 'global' ? i18n.t('最近活跃的 Agent 会话。') : i18n.t('属于这个范围的 Agent 会话，按记录的来源或会话标识匹配。')}
        actions={<Button asChild variant="secondary" size="sm"><Link to={sessionsLink.href}><ArrowUpRight />{i18n.t('在聊天记录中打开')}</Link></Button>}
      >
        <Card className="overflow-hidden p-0">
          {sessions.status === 'loading' ? (
            <StatusState kind="loading" className="m-4" placeholder={<div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-10" />)}</div>} />
          ) : sessions.status === 'error' ? (
            <StatusState compact error={sessions.error} permissions={['status.view']} />
          ) : sessions.state === 'unattributed' ? (
            <StatusState compact kind="empty" illustration="messages" title={i18n.t(UNATTRIBUTED_TITLES[level === 'global' ? 'endpoint' : level])}
              description={i18n.t('现在的会话记录没有写明来自哪个账号（需要更新的 Host），{0} 个会话无法确定是否属于这里。可以在「会话 → 聊天记录」查看全部会话。', [sessions.unattributed])}
              actions={<Button asChild size="sm" variant="secondary"><Link to={CONSOLE_PATHS.agentSessions}>{i18n.t('查看全部会话')}</Link></Button>} />
          ) : sessions.rows.length === 0 ? (
            <StatusState compact kind="empty" illustration="messages" title={i18n.t('还没有聊天记录')}
              description={i18n.t('机器人在这个范围里处理过消息后，会话会出现在这里。')}
              actions={level === 'endpoint' || level === 'conversation'
                ? <Button asChild size="sm" variant="secondary"><Link to={scopeHref(scope, 'chat')}>{i18n.t('打开聊天')}</Link></Button>
                : <Button asChild size="sm" variant="secondary"><Link to={scopeHref(scope)}>{i18n.t('查看聊天账号')}</Link></Button>} />
          ) : (
            <>
              <ul className="console-records-sessions">
                {sessions.rows.map(row => <SessionRow key={row.sessionKey} row={row} showAccount={level === 'global' || level === 'adapter'} />)}
              </ul>
              {sessions.total > sessions.rows.length ? (
                <p className="console-records-more">{i18n.t('还有 {0} 个会话，在聊天记录中查看全部。', [sessions.total - sessions.rows.length])}</p>
              ) : null}
              {sessions.unattributed > 0 ? (
                <p className="console-records-more">
                  {i18n.t('另有 {0} 个会话的记录没有写明来自哪个账号，没有列在这里。', [sessions.unattributed])}{' '}
                  <Button asChild variant="link" size="sm" className="h-auto p-0"><Link to={CONSOLE_PATHS.agentSessions}>{i18n.t('查看全部会话')}</Link></Button>
                </p>
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
                  {source.filter ? <p className="console-records-source-filter"><span className="shrink-0 whitespace-nowrap">{i18n.t('筛选：')}</span><code title={source.filter}>{source.filter}</code></p> : null}
                  <Button asChild variant="secondary" size="sm" className="console-records-source-open">
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
