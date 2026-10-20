import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { readPreviewEndpoints, type PreviewEndpoint } from '../../pages/introspection/target-preview.mjs'
import { CONVERSATION_KINDS, CONVERSATION_KIND_LABELS, endpointKey, targetDraft, targetDraftIssue, updateTargetField, updateTargetParent, createScopeReadGate, type ConversationKind } from './conversation-scope-model.mjs'

export type { ConversationKind } from './conversation-scope-model.mjs'

export interface ConversationTargetEditorProps {
  value: unknown
  onChange: (value: unknown) => void
  allowedKinds?: readonly ConversationKind[]
  idPrefix?: string
  disabled?: boolean
}
const control = 'mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm'

/** Edits only a draft. Endpoint discovery is read-only and scoped to the current login. */
export function ConversationTargetEditor({ value, onChange, allowedKinds = CONVERSATION_KINDS, idPrefix, disabled = false }: ConversationTargetEditorProps) {
  const generatedId = useId(), prefix = idPrefix ?? generatedId, scope = useInboxCacheScope()
  const gate = useRef(createScopeReadGate(getInboxCacheScope))
  const [catalog, setCatalog] = useState<{scope?: string; rows: PreviewEndpoint[]; error?: string; loading?: boolean}>({ rows: [] })
  useEffect(() => { gate.current.cancel(); setCatalog({rows: []}); return () => gate.current.cancel() }, [scope])
  const active = catalog.scope === scope && isInboxCacheScopeActive(scope)
  const endpoints = active ? catalog.rows : [], draft = targetDraft(value), selected = endpointKey(draft.endpoint)
  const currentEndpoint = endpoints.find(row => endpointKey(row.endpoint) === selected)
  const issue = targetDraftIssue(value, allowedKinds)
  async function loadEndpoints() {
    const request = gate.current.begin()
    if (!request.scope || request.scope !== scope || disabled) return
    setCatalog({scope: request.scope, rows: [], loading: true})
    try {
      const rows = readPreviewEndpoints(await requestConsole({type: ENDPOINT_RPC.LIST}))
      if (request.current()) setCatalog({scope: request.scope, rows, error: rows.length ? undefined : '当前 Host 没有可选择的账号；请先配置 Endpoint。'})
    } catch (error) { if (request.current()) setCatalog({scope: request.scope, rows: [], error: error instanceof Error ? error.message : '账号列表读取失败'}) }
  }
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || active && catalog.loading} onClick={() => void loadEndpoints()}>{active && catalog.loading ? '正在读取账号…' : '读取当前 Host 账号'}</Button><span className="text-xs text-muted-foreground">仅读取列表，不验证平台或发送消息。</span></div>
    {active && catalog.error ? <p role="alert" className="break-words text-xs text-destructive">{catalog.error}</p> : null}
    <label className="block text-sm" htmlFor={`${prefix}-endpoint`}>目标账号<select id={`${prefix}-endpoint`} className={control} disabled={disabled} value={selected} onChange={event => {
      const endpoint = endpoints.find(row => endpointKey(row.endpoint) === event.target.value)?.endpoint
      if (endpoint) onChange(updateTargetField(value, 'endpoint', {...draft.endpoint, ...endpoint}))
    }}><option value="">请先读取并选择完整账号</option>{selected && !currentEndpoint ? <option value={selected}>已配置完整账号（当前列表未核对）</option> : null}{endpoints.map(row => <option key={endpointKey(row.endpoint)} value={endpointKey(row.endpoint)}>{row.name} · {row.endpoint.adapter}{row.connected ? '' : '（离线）'}</option>)}</select></label>
    {selected ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">账号完整身份</summary><p className="mt-1 break-all">{draft.endpoint.adapter} / {draft.endpoint.id}</p></details> : null}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm" htmlFor={`${prefix}-kind`}>会话类型<select id={`${prefix}-kind`} className={control} disabled={disabled} value={draft.kind} onChange={event => onChange(updateTargetField(value, 'kind', event.target.value))}><option value="">请选择类型</option>{draft.kind && !allowedKinds.includes(draft.kind as ConversationKind) ? <option value={draft.kind}>当前类型不在允许范围：{draft.kind}</option> : null}{allowedKinds.map(kind => <option key={kind} value={kind}>{CONVERSATION_KIND_LABELS[kind]}</option>)}</select></label>
      <label className="min-w-0 text-sm" htmlFor={`${prefix}-id`}>会话 ID<Input id={`${prefix}-id`} className="mt-1" disabled={disabled} value={draft.id} onChange={event => onChange(updateTargetField(value, 'id', event.target.value))} placeholder="平台实际会话 ID" /></label>
      <label className="min-w-0 text-sm" htmlFor={`${prefix}-parent-kind`}>父容器类型（可选）<select id={`${prefix}-parent-kind`} className={control} disabled={disabled} value={draft.parentKind} onChange={event => onChange(updateTargetParent(value, 'kind', event.target.value))}><option value="">未指定</option>{draft.parentKind && !CONVERSATION_KINDS.includes(draft.parentKind as ConversationKind) ? <option value={draft.parentKind}>{draft.parentKind}（待校验）</option> : null}{CONVERSATION_KINDS.map(kind => <option key={kind} value={kind}>{CONVERSATION_KIND_LABELS[kind]}</option>)}</select></label>
      <label className="min-w-0 text-sm" htmlFor={`${prefix}-parent-id`}>父容器 ID<Input id={`${prefix}-parent-id`} className="mt-1" disabled={disabled} value={draft.parentId} onChange={event => onChange(updateTargetParent(value, 'id', event.target.value))} placeholder="频道所属服务器等实际 ID" /></label>
    </div>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(updateTargetField(value, 'parent', undefined))}>明确不含父容器</Button>
    <label className="block text-sm" htmlFor={`${prefix}-thread`}>话题 / 回复串 ID（可选）<Input id={`${prefix}-thread`} className="mt-1" disabled={disabled} value={draft.threadId} onChange={event => onChange(updateTargetField(value, 'threadId', event.target.value))} placeholder="实际话题 ID；不是通配条件" /></label>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(updateTargetField(value, 'threadId', undefined))}>明确不含话题</Button>
    <p className="text-xs text-muted-foreground">保留会话实际具有的父容器和话题；留空表示未提供该层身份，不会自动填补或推断。没有平台目录时，请手填真实会话 ID，不要把账号昵称当完整身份。</p>
    {issue ? <p role="alert" className="text-xs text-destructive">草稿待完善：{issue} 最终以 Host 校验为准。</p> : null}
    <ConversationTargetSummary value={value} accountName={currentEndpoint?.name} />
  </div>
}

export function ConversationTargetSummary({value, accountName}: {value: unknown; accountName?: string}) {
  const draft = targetDraft(value)
  return <div className="min-w-0 rounded-md bg-muted/40 p-3 text-xs">
    <p className="break-words">账号：{accountName ?? (draft.endpoint.id ? '完整 ID 见下方详情' : '尚未选择')}</p>
    <p className="break-all">会话：{CONVERSATION_KIND_LABELS[draft.kind as ConversationKind] ?? '尚未选择类型'} · {draft.id || '尚未填写 ID'}</p>
    <p className="break-all">父容器：{draft.parentKind || draft.parentId ? `${CONVERSATION_KIND_LABELS[draft.parentKind as ConversationKind] ?? draft.parentKind} / ${draft.parentId || '待填写'}` : '未提供'}</p>
    <p className="break-all">话题：{draft.threadId || '未提供'}</p>
    <details className="mt-2"><summary className="cursor-pointer">完整身份草稿</summary><pre className="mt-2 max-w-full whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2) ?? '尚未设置'}</pre></details>
  </div>
}
