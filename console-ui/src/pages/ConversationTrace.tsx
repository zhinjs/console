import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Wrench } from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion'
import { ErrorAlert } from '../components/error-alert'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import type { DiagnosticConversation } from './endpoint-detail/types'
import { ContextUsage, UsageSummary } from './ConversationUsage'
import {
  formatTraceMetric, promptContent, readTraceDetail, readTraceRequest, traceBodyStatus, traceFailure,
  traceQuery, traceStatus, traceUsage, type TraceDetail, type TraceRequest, type TraceTurn,
} from './conversation-trace-model.mjs'

function useTraceRead<T>(path: string, connectionScope: string | undefined, read: (body: unknown) => T) {
  const identity = JSON.stringify([connectionScope, path])
  const current = useRef(identity)
  current.current = identity
  const parser = useRef(read)
  parser.current = read
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ identity: string; data: T | null; error: string | null }>({ identity, data: null, error: null })
  useEffect(() => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    const controller = new AbortController()
    let alive = true
    const active = () => alive && current.current === identity && isInboxCacheScopeActive(connectionScope)
    setState({ identity, data: null, error: null })
    void apiFetch(path, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!active()) return
      if (!response.ok) throw new Error(traceFailure(response.status))
      const body: unknown = await response.json()
      if (active()) setState({ identity, data: parser.current(body), error: null })
    }).catch(error => { if (active()) setState({ identity, data: null, error: error instanceof Error ? error.message : traceFailure(0) }) })
    return () => { alive = false; controller.abort() }
  }, [identity, path, connectionScope, attempt])
  const active = state.identity === identity && isInboxCacheScopeActive(connectionScope)
  return { data: active ? state.data : null, error: active ? state.error : null, retry: () => { if (isInboxCacheScopeActive(connectionScope) && current.current === identity) setAttempt(value => value + 1) } }
}

const roleLabels: Record<string, string> = { user: '用户', assistant: '助手', tool: '工具', system: '系统', developer: '开发者' }

export function RequestBody({ request }: { request: TraceRequest }) {
  const i18n = useI18n()
  const body = request.body
  if (!body) return <p className="conversation-trace-empty">{traceBodyStatus(request.body_status, i18n.locale)}</p>
  const estimate = request.estimated_tokens
  const amount = (value?: number) => value === undefined ? '' : `≈ ${new Intl.NumberFormat(i18n.locale).format(value)} tok`
  return <Accordion type="multiple" className="conversation-request-sections">
    {body.system !== undefined ? <AccordionItem value="system"><AccordionTrigger><span>{i18n.t('系统提示')}</span><small>{amount(estimate?.system)}</small></AccordionTrigger>
      <AccordionContent><pre>{body.system}</pre></AccordionContent></AccordionItem> : null}
    <AccordionItem value="tools"><AccordionTrigger><span>{i18n.t('工具定义')} · {body.tools.length}</span><small>{amount(estimate?.tools)}</small></AccordionTrigger>
      <AccordionContent>{body.tools.length ? body.tools.map((tool, index) => <section key={`${index}:${tool.name}`} className="conversation-request-tool"><h5>{tool.name}</h5>{tool.description ? <pre>{tool.description}</pre> : null}<pre>{promptContent(tool.input_schema)}</pre></section>) : <p>{i18n.t('无工具定义')}</p>}</AccordionContent></AccordionItem>
    <AccordionItem value="messages"><AccordionTrigger><span>{i18n.t('消息序列')} · {body.messages.length}</span><small>{amount(estimate?.messages)}</small></AccordionTrigger>
      <AccordionContent>{body.messages.map((message, index) => <section className="conversation-request-message" key={index}><h5><span>{index + 1}</span>{i18n.t(roleLabels[message.role] ?? '其他角色')}</h5><pre>{promptContent(message.content)}</pre></section>)}</AccordionContent></AccordionItem>
    {body.output_schema !== undefined ? <AccordionItem value="output"><AccordionTrigger><span>{i18n.t('输出格式')}</span><small>{amount(estimate?.output_schema)}</small></AccordionTrigger><AccordionContent><pre>{promptContent(body.output_schema)}</pre></AccordionContent></AccordionItem> : null}
  </Accordion>
}

export function RequestDetails({ sessionKey, turnId, requestId, connectionScope, conversation }: { sessionKey: string; turnId: string; requestId: string; connectionScope?: string; conversation: DiagnosticConversation }) {
  const i18n = useI18n()
  const result = useTraceRead(traceQuery('request', sessionKey, turnId, requestId, conversation), connectionScope, body => readTraceRequest(body, sessionKey, turnId, requestId))
  if (!isInboxCacheScopeActive(connectionScope)) return null
  if (result.error) return <ErrorAlert error={i18n.t(result.error)} onRetry={result.retry} />
  return result.data ? <>{result.data.usage ? <UsageSummary turns={[{ usage_calls: [result.data.usage] }]} /> : null}<RequestBody request={result.data} /></> : <p role="status" className="conversation-trace-empty">{i18n.t('加载中…')}</p>
}

function TurnRequests({ detail, sessionKey, rootTurnId, connectionScope, conversation }: { detail: TraceDetail; sessionKey: string; rootTurnId: string; connectionScope?: string; conversation: DiagnosticConversation }) {
  const i18n = useI18n()
  const [openRequest, setOpenRequest] = useState('')
  return <>
    {detail.requests?.length ? <Accordion type="single" collapsible value={openRequest} onValueChange={setOpenRequest} className="conversation-request-list">
      {detail.requests.map(request => <AccordionItem key={request.request_id} value={request.request_id}>
        <AccordionTrigger><span><strong>{i18n.t('模型请求 {0}', [request.index])}</strong><small>{[request.provider, request.model].filter(Boolean).join(' / ')}</small></span>
          <span className="conversation-request-status">{traceStatus(request.status, i18n.locale)}{request.duration_ms === undefined ? '' : ` · ${(request.duration_ms / 1000).toFixed(1)}s`}</span></AccordionTrigger>
        <AccordionContent>{openRequest === request.request_id ? <RequestDetails key={request.request_id} sessionKey={sessionKey} turnId={rootTurnId} requestId={request.request_id} connectionScope={connectionScope} conversation={conversation} /> : null}</AccordionContent>
      </AccordionItem>)}
    </Accordion> : <p className="conversation-trace-empty">{i18n.t('此回合没有保留模型请求正文。')}</p>}
    {detail.tool_calls.length ? <section className="conversation-trace-tools"><h4><Wrench />{i18n.t('工具调用')}</h4>
      {detail.tool_calls.map((tool, index) => <details key={`${tool.tool_use_id}:${index}`}><summary><span>{tool.tool_name}</span><span>{traceStatus(tool.status, i18n.locale)}{tool.duration_ms === undefined ? '' : ` · ${(tool.duration_ms / 1000).toFixed(1)}s`}</span></summary><pre>{tool.args_summary}</pre>{tool.error ? <p role="alert">{tool.error}</p> : null}</details>)}
    </section> : null}
    {detail.subagents.map(child => <section key={child.turn_id} className="conversation-trace-subagent"><h4>{i18n.t('子任务')} · {traceStatus(child.termination.status, i18n.locale)}</h4><TurnRequests detail={child} sessionKey={sessionKey} rootTurnId={rootTurnId} connectionScope={connectionScope} conversation={conversation} /></section>)}
  </>
}

export function TurnDetails({ turn, connectionScope, conversation }: { turn: TraceTurn; connectionScope?: string; conversation: DiagnosticConversation }) {
  const i18n = useI18n()
  const result = useTraceRead(traceQuery('turn', turn.session_key, turn.turn_id, undefined, conversation), connectionScope, body => readTraceDetail(body, turn.session_key, turn.turn_id, 'zh-CN', conversation))
  if (!isInboxCacheScopeActive(connectionScope)) return null
  return <section className="conversation-turn-detail">
    <UsageSummary turns={[turn]} />
    {turn.context_budget ? <details className="conversation-turn-context"><summary>{i18n.t('上下文构成')}</summary><ContextUsage budget={turn.context_budget} /></details> : null}
    {result.error ? <ErrorAlert error={i18n.t(result.error)} onRetry={result.retry} /> : result.data ? <TurnRequests key={result.data.turn_id} detail={result.data} sessionKey={turn.session_key} rootTurnId={turn.turn_id} connectionScope={connectionScope} conversation={conversation} /> : <p role="status" className="conversation-trace-empty">{i18n.t('加载中…')}</p>}
  </section>
}

export function ConversationTrace({ turns, loading, error, refresh, selectedTurn, onSelectTurn, connectionScope, conversation, revision = 0 }: {
  turns: TraceTurn[]; loading: boolean; error: string | null; refresh: () => void; selectedTurn: string; onSelectTurn: (id: string) => void; connectionScope?: string; conversation?: DiagnosticConversation; revision?: number
}) {
  const i18n = useI18n()
  const time = new Intl.DateTimeFormat(i18n.locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return <section className="conversation-traces" aria-label={i18n.t('轨迹')}>
    <div className="conversation-trace-toolbar"><span>{i18n.t('最近 {0} 个回合', [turns.length])}</span><Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>{i18n.t('刷新')}</Button></div>
    {error ? <ErrorAlert error={i18n.t(error)} onRetry={refresh} /> : null}
    {loading && !turns.length ? <p role="status" className="conversation-trace-empty">{i18n.t('加载中…')}</p> : !error && !turns.length ? <p className="conversation-trace-empty">{i18n.t('暂无可关联的轨迹')}</p> : null}
    {turns.map(turn => {
      const selected = selectedTurn === turn.turn_id
      const models = [...new Set(turn.usage_calls?.map(call => call.model).filter(Boolean) ?? [])]
      return <article key={turn.turn_id} className={`conversation-trace-turn${selected ? ' is-open' : ''}`}>
        <Button variant="ghost" className="conversation-trace-heading h-auto w-full justify-start gap-3 whitespace-normal text-left" onClick={() => onSelectTurn(selected ? '' : turn.turn_id)} aria-expanded={selected} aria-controls={`trace-${turn.turn_id}`}>
          <ChevronRight /><span><strong>{time.format(turn.started_at)}</strong><small>{models.join(' · ') || i18n.t('模型未记录')}</small></span>
          <span className="conversation-trace-overview"><span>{traceStatus(turn.termination.status, i18n.locale)}</span><small>{formatTraceMetric(traceUsage([turn]).totalTokens, i18n.locale)} tok{turn.duration_ms === undefined ? '' : ` · ${(turn.duration_ms / 1000).toFixed(1)}s`}</small></span>
        </Button>
        {selected && conversation ? <div id={`trace-${turn.turn_id}`}><TurnDetails key={`${connectionScope}:${turn.turn_id}:${revision}`} turn={turn} connectionScope={connectionScope} conversation={conversation} /></div> : null}
      </article>
    })}
  </section>
}
