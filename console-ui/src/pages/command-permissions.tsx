import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Blocks, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Alert, AlertDescription } from '../components/ui/alert'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import { ConversationTargetEditor, ConversationTargetSummary } from '../components/PluginConfigForm/ConversationTargetEditor'
import { apiFetch } from '../utils/auth'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { HYPOTHETICAL_CHAT_ROLES, HYPOTHETICAL_STANDINGS, permissionHttpError, permissionOutcomeLabel, permissionRequest, permitRuleMeaning, readPermissionCatalog, readPermissionExplanation,
  type HypotheticalChatRole, type HypotheticalStanding,
  type PermissionCatalog, type PermissionCommand, type PermissionExplanation, type PermissionRequest } from './permission-explanation-model.mjs'
import { matchPermissionLink, permissionCatalogState, permissionLinkSearch, readPermissionLink, type PermissionLink } from './permission-link-model.mjs'


const CHAT_ROLE_OPTION_LABELS: Record<HypotheticalChatRole, string> = { '': '未知', none: '普通用户（没有 zhin 角色）', owner: '所有者', admin: '管理员', trusted: '受信任' }
const STANDING_OPTION_LABELS: Record<HypotheticalStanding, string> = { '': '未知', owner: '群主', admin: '管理员', member: '成员', guest: '访客' }

export default function CommandPermissionsPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const catalogReads = useRef(createDiagnosticRequestGate(getInboxCacheScope)), explanations = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [catalog, setCatalog] = useState<{ scope: typeof scope; value: PermissionCatalog } | null>(null)
  const [selected, setSelected] = useState<PermissionCommand | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null), [linkNotice, setLinkNotice] = useState<'missing' | 'ambiguous' | null>(null)
  // Command requested by the URL (deep link or reload); consumed by the next catalog read.
  const pendingLink = useRef<PermissionLink | null>(null), lastPage = useRef(1)
  const [hypothesis, setHypothesis] = useState(false), [target, setTarget] = useState<unknown>(undefined)
  const [includeTarget, setIncludeTarget] = useState(false)
  const [senderId, setSenderId] = useState(''), [roles, setRoles] = useState('')
  const [chatRole, setChatRole] = useState<HypotheticalChatRole>(''), [standing, setStanding] = useState<HypotheticalStanding>('')
  const [result, setResult] = useState<{ scope: typeof scope; request: PermissionRequest; value: PermissionExplanation } | null>(null)
  const active = isInboxCacheScopeActive(scope), denied = !hasConsolePermission('status.view')
  const current = active && catalog && catalog.scope === scope ? catalog.value : null
  const visible = current && result && result.scope === scope && result.request.generation === current.generation
    && result.request.commandId === selected?.id ? result.value : null

  const loadCatalog = useCallback(async (nextPage = lastPage.current, q = query) => {
    if (!isInboxCacheScopeActive(scope) || denied) return
    lastPage.current = nextPage
    explanations.current.cancel(); setResult(null); setSelected(null); setChecking(false); setCatalog(null)
    const request = catalogReads.current.begin(); setLoading(true); setError(null); setCatalogError(null); setLinkNotice(null)
    try {
      const search = new URLSearchParams({ page: String(nextPage), pageSize: '50', q, locale: i18n.locale })
      const response = await apiFetch(`${CONSOLE_REST.COMMAND_PERMISSIONS}?${search}`, { signal: request.signal, cache: 'no-store' })
      if (!request.current() || !isInboxCacheScopeActive(scope)) return
      if (!response.ok) throw new Error(permissionHttpError(response.status, i18n.locale))
      const next = readPermissionCatalog(await response.json(), i18n.locale)
      if (request.current() && isInboxCacheScopeActive(scope)) setCatalog({ scope, value: next })
    } catch (caught) { if (request.current() && isInboxCacheScopeActive(scope)) setCatalogError(caught instanceof Error ? caught.message : i18n.t("权限目录读取失败，请刷新。")) }
    finally { if (request.current()) setLoading(false) }
  }, [scope, denied, query, i18n])
  const loadRef = useRef(loadCatalog); loadRef.current = loadCatalog
  const linkRef = useRef(searchParams); linkRef.current = searchParams

  useEffect(() => {
    catalogReads.current.cancel(); explanations.current.cancel(); setCatalog(null); setSelected(null); setResult(null)
    setTarget(undefined); setSenderId(''); setRoles(''); setHypothesis(false); setIncludeTarget(false); setQuery(''); setChecking(false); setLoading(false); setError(null)
    setCatalogError(null); setLinkNotice(null); pendingLink.current = null; lastPage.current = 1
    return () => { catalogReads.current.cancel(); explanations.current.cancel() }
  }, [scope])

  // Read the catalog on entry (and whenever the Host scope becomes usable) instead of waiting for a click.
  // Only scope/availability changes re-run this, so a language switch never discards the current selection.
  useEffect(() => {
    if (!active || denied) return
    const link = readPermissionLink(linkRef.current)
    // `?q=` (from the plugin detail page) pre-fills the search with a plugin instance.
    const initial = link?.name ?? linkRef.current.get('q')?.trim().slice(0, 200) ?? ''
    pendingLink.current = link; setQuery(initial)
    void loadRef.current(1, initial)
  }, [scope, active, denied])

  const explain = async (command: PermissionCommand, useHypothesis: boolean) => {
    if (!current || !isInboxCacheScopeActive(scope) || loading || denied) return
    explanations.current.cancel(); setResult(null); setError(null)
    let body: PermissionRequest
    try { body = permissionRequest(current.generation, command, useHypothesis ? { target: includeTarget ? target : undefined, requireTarget: includeTarget, senderId, chatRole, standing, platformRoles: roles } : undefined, i18n.locale) }
    catch (caught) { setError((caught as Error).message); return }
    const request = explanations.current.begin(); setChecking(true)
    try {
      const response = await apiFetch(`${CONSOLE_REST.COMMAND_PERMISSION_EXPLAIN}?${new URLSearchParams({ locale: i18n.locale })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: request.signal, cache: 'no-store' })
      if (!request.current() || !isInboxCacheScopeActive(scope)) return
      if (!response.ok) { if (response.status === 409) { setCatalog(null); setSelected(null) }; throw new Error(permissionHttpError(response.status, i18n.locale)) }
      const next = readPermissionExplanation(await response.json(), body, i18n.locale)
      if (request.current() && isInboxCacheScopeActive(scope)) setResult({ scope, request: body, value: next })
    } catch (caught) { if (request.current() && isInboxCacheScopeActive(scope)) setError(caught instanceof Error ? caught.message : i18n.t("权限说明读取失败，请重试。")) }
    finally { if (request.current()) setChecking(false) }
  }
  const invalidateHypothesis = () => { explanations.current.cancel(); setChecking(false); setResult(null); setError(null) }
  const choose = (command: PermissionCommand) => {
    explanations.current.cancel(); setHypothesis(false); setSelected(command); setResult(null); setLinkNotice(null)
    setSearchParams(permissionLinkSearch(command), { replace: true }); void explain(command, false)
  }
  // A manual read clears the selection, so drop the stale command from the URL as well.
  const reload = (nextPage: number) => { pendingLink.current = null; if (readPermissionLink(searchParams)) setSearchParams(new URLSearchParams(), { replace: true }); void loadCatalog(nextPage) }

  // Once the catalog requested by a link arrives, select that command if it is unambiguous.
  useEffect(() => {
    const link = pendingLink.current
    if (!current || !link) return
    pendingLink.current = null
    const match = matchPermissionLink(current.commands, link)
    if (match.status === 'matched') choose(match.command)
    else setLinkNotice(match.status === 'ambiguous' ? 'ambiguous' : 'missing')
  }, [current])
  const catalogState = permissionCatalogState({ denied, active, loading, error: catalogError, catalog: current })

  return <PageShell className="max-w-6xl">
    <PageHeader title={i18n.t("命令权限说明")}
      description={i18n.t("查看规则为什么匹配。这里只做说明与假设检查，不执行命令，也不向平台查询或验证权限。")}
      actions={<Button asChild variant="outline" size="sm"><Link to="/introspection?tab=commands"><Blocks />{i18n.t("返回命令目录")}</Link></Button>} />
    {denied ? <StatusState kind="forbidden" permissions={['status.view']} />
      : !active ? <StatusState kind="disconnected" description={i18n.t("需要连接当前 Host 并使用有状态查看权限的身份读取权限说明。")} /> : null}
    <Card><CardHeader><CardTitle>{i18n.t("选择当前运行代的命令")}</CardTitle></CardHeader><CardContent className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); reload(1) }}>
        <Input aria-label={i18n.t("搜索权限命令")} placeholder={i18n.t("搜索命令或插件实例")} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" disabled={denied || !active || loading}><RefreshCw className="size-4 mr-2" />{current || catalogError ? i18n.t("重新读取") : i18n.t("读取目录")}</Button>
      </form>
      {catalogState === 'loading' && <StatusState kind="loading" compact title={i18n.t("正在读取当前命令目录…")} />}
      {catalogState === 'error' && <StatusState compact error={catalogError} title={i18n.t("命令目录读取失败")} onRetry={() => void loadCatalog()} />}
      {catalogState === 'idle' && <p className="text-sm text-muted-foreground">{i18n.t("尚未读取命令目录。")}</p>}
      {linkNotice && <Alert><AlertDescription>{linkNotice === 'ambiguous' ? i18n.t("链接中的命令对应多个插件实例，请从列表中选择。") : i18n.t("当前目录中没有找到链接中的命令，请搜索或从列表中选择。")}</AlertDescription></Alert>}
      {current && <><p className="text-xs text-muted-foreground">{i18n.t("运行代 ")}{current.generation} {i18n.t(" · 共 ")}{current.total} {i18n.t(" 项 · 第 ")}{current.page} {i18n.t(" 页")}</p>
        {!current.commands.length ? <StatusState compact kind="empty" title={i18n.t("当前筛选没有命令。")} description={i18n.t("换个关键词，或清空搜索查看全部命令。")} /> : <div className="grid gap-2 sm:grid-cols-2">{current.commands.map(command => <button type="button" key={command.id} aria-pressed={selected?.id === command.id}
          className={`min-w-0 text-left rounded-md border p-3 space-y-1 ${selected?.id === command.id ? 'border-primary bg-muted/40' : ''}`} onClick={() => choose(command)}>
          <span className="block font-medium break-words">{command.name}</span><span className="block text-xs text-muted-foreground break-all">{command.owner}</span><span className="block text-sm break-words">{command.description}</span></button>)}</div>}
        <div className="flex gap-2"><Button variant="outline" disabled={loading || current.page <= 1} onClick={() => reload(current.page - 1)}>{i18n.t("上一页")}</Button>
          <Button variant="outline" disabled={loading || current.page * current.pageSize >= current.total} onClick={() => reload(current.page + 1)}>{i18n.t("下一页")}</Button></div></>}
    </CardContent></Card>
    {selected && current && <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle className="break-words">{selected.name}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm">{i18n.t("permit 数组中的条件必须全部满足；同一项括号内的逗号表示任选一个。平台和自定义 checker 均不会执行。")}</p>
      <label className="flex gap-2 items-start text-sm"><Checkbox checked={hypothesis} onCheckedChange={checked => { invalidateHypothesis(); setHypothesis(checked === true) }} />{i18n.t("使用假设会话和身份检查内置条件")}</label>
      {hypothesis && <div className="space-y-3"><label className="flex gap-2 items-start text-sm"><Checkbox checked={includeTarget} onCheckedChange={checked => { invalidateHypothesis(); setIncludeTarget(checked === true) }} />{i18n.t("提供假设会话与账号（可选）")}</label>
        {includeTarget && <ConversationTargetEditor value={target} onChange={value => { invalidateHypothesis(); setTarget(value) }} idPrefix="permission-target" disabled={checking} />}
        <label className="block space-y-1 text-sm"><span>{i18n.t("假设发送者 ID（可选）")}</span><Input value={senderId} maxLength={200} onChange={event => { invalidateHypothesis(); setSenderId(event.target.value) }} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-sm"><span>{i18n.t("假设 zhin 角色（可选）")}</span>
            <SelectField aria-label={i18n.t("假设 zhin 角色（可选）")} value={chatRole || 'unknown'} onValueChange={value => { invalidateHypothesis(); setChatRole(value === 'unknown' ? '' : value as HypotheticalChatRole) }}
              options={HYPOTHETICAL_CHAT_ROLES.map(value => ({ value: value || 'unknown', label: i18n.t(CHAT_ROLE_OPTION_LABELS[value]) }))} /></div>
          <div className="space-y-1 text-sm"><span>{i18n.t("假设平台身份（可选）")}</span>
            <SelectField aria-label={i18n.t("假设平台身份（可选）")} value={standing || 'unknown'} onValueChange={value => { invalidateHypothesis(); setStanding(value === 'unknown' ? '' : value as HypotheticalStanding) }}
              options={HYPOTHETICAL_STANDINGS.map(value => ({ value: value || 'unknown', label: i18n.t(STANDING_OPTION_LABELS[value]) }))} /></div>
        </div>
        {standing ? <label className="block space-y-1 text-sm"><span>{i18n.t("平台角色（逗号分隔，可选）")}</span><Input value={roles} maxLength={2000} placeholder={i18n.t("平台自定义的角色 ID；留空表示未知")} onChange={event => { invalidateHypothesis(); setRoles(event.target.value) }} /></label> : null}
        <p className="text-xs text-muted-foreground">{i18n.t("这里的身份完全由你假设，未向平台核实。zhin 角色只来自授予；平台群主/管理员是平台身份，单独影响平台相关条件。留空表示未知，不会被当作已知角色。")}</p></div>}
      <Button disabled={checking || loading || !active || denied} onClick={() => void explain(selected, hypothesis)}>{checking ? i18n.t("读取中…") : hypothesis ? i18n.t("检查假设条件") : i18n.t("重新查看规则")}</Button>
    </CardContent></Card><Card><CardHeader><CardTitle>{i18n.t("条件说明")}</CardTitle></CardHeader><CardContent className="space-y-4">
      {checking && <StatusState kind="loading" compact title={i18n.t("正在读取规则说明…")} />}
      {visible && <><Alert><AlertDescription><strong>{permissionOutcomeLabel(visible.summary.outcome, i18n.locale)}</strong>：{visible.summary.reason}{i18n.t("。此结果不代表已授权或可执行。")}</AlertDescription></Alert>
        <p className="text-xs text-muted-foreground">Permission Host：{visible.permissionHost === 'present' ? i18n.t("当前存在") : visible.permissionHost === 'missing' ? i18n.t("当前缺失") : i18n.t("未核实")} {i18n.t(" · 运行代 ")}{visible.generation}</p>
        <div className="rounded-md border p-3 text-sm"><p className="font-medium">{i18n.t("Adapter 约束 · ")}{permissionOutcomeLabel(visible.adapter.outcome, i18n.locale)}</p><p className="mt-1 text-muted-foreground">{visible.adapter.reason}</p></div>
        {!visible.rules.length && <p className="text-sm">{i18n.t("没有声明 permit 限制；这不等于已获得平台执行权限。")}</p>}
        <ol className="space-y-3">{visible.rules.map(rule => <li key={rule.index} className="rounded-md border p-3 space-y-1"><div className="flex flex-wrap gap-2 justify-between"><code className="text-sm break-all">{rule.rule}</code><span className="text-xs shrink-0">{permissionOutcomeLabel(rule.outcome, i18n.locale)}</span></div>{permitRuleMeaning(rule, i18n.locale) ? <p className="text-sm font-medium">{permitRuleMeaning(rule, i18n.locale)}</p> : null}<p className="text-sm text-muted-foreground">{rule.reason}</p></li>)}</ol>
        {visible.target && <div className="space-y-2"><p className="text-sm font-medium">{i18n.t("本次假设会话")}</p><ConversationTargetSummary value={visible.target} /></div>}
        <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">{[...visible.unconstrained, ...visible.assumptions].map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      {!checking && !visible && <p className="text-sm text-muted-foreground">{i18n.t("选择命令查看规则；修改假设后需要重新检查，不沿用旧结果。")}</p>}
    </CardContent></Card></div>}
    {error && <StatusState compact error={error} />}
  </PageShell>
}
