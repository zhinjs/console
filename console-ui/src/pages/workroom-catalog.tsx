import { useCallback, useEffect, useMemo, useRef, useState, useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot,
  Boxes,
  Database,
  GitFork,
  LayoutDashboard,
  Loader2,
  Plus,
  RadioTower,
  RefreshCw,
  Route,
  Save,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { cn, getWebSocketManager } from '@zhin.js/client'
import { createWorkroomDraftSessions } from './workroom-draft-session.mjs'
import { CONSOLE_RPC, ENDPOINT_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'
import { isDemoMode } from '../utils/demo-mode'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ConfirmDialog } from '../components/confirm-dialog'
import { EmptyState } from '../components/empty-state'
import { ErrorAlert } from '../components/error-alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import {
  catalogAvailability,
  createNewWorkroomDraft,
  endpointRouteKey,
  parseEndpointRouteKey,
  validateWorkroomSponsors,
  validateWorkroomProjectIds,
  validateWorkroomBasics,
  validateWorkroomSpaceOwnership,
  workroomDefinitionsMatch,
  validateWorkroomMembers,
  type WorkroomMemberIssues,
  type BasicIssues,
  type BindingIssues,
  validateWorkroomMessageRoutes,
  type MessageRoute as WorkroomMessageRoute,
  type MessageRouteIssue,
} from './workroom-catalog-model.mjs'

type MemberRole = 'orchestrator' | 'executor' | 'reviewer' | 'integration'
type SpaceKind = 'group' | 'channel' | 'repository'

interface AssignmentRoute {
  kind: 'local' | 'remote'
  endpointId?: string
}

interface WorkroomMember {
  agent: string
  role: MemberRole
  assignmentRoute?: AssignmentRoute
  messageRoute?: WorkroomMessageRoute
}

interface ConversationBinding {
  adapter: string
  endpoint: string
  kind: SpaceKind
  id: string
  agent: string
}

interface WorkroomDefinition {
  name: string
  description?: string
  enabled?: boolean
  members: WorkroomMember[]
  sponsors?: string[]
  conversation?: ConversationBinding
  sponsorConversation?: ConversationBinding
}

interface WorkroomCatalog {
  agents: Record<string, { provider?: string; model?: string; nickname?: string }>
  workrooms: Record<string, WorkroomDefinition>
  revision: string
  principalId?: string
}

interface EndpointOption {
  name: string
  adapter: string
  connected: boolean
}

interface WorkroomDraft extends WorkroomDefinition {
  projectId: string
}

const ROLES: readonly MemberRole[] = ['orchestrator', 'executor', 'reviewer', 'integration']
const SPACE_KINDS: readonly SpaceKind[] = ['group', 'channel', 'repository']

function copyDefinition(definition: WorkroomDefinition): WorkroomDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkroomDefinition
}

function toDrafts(workrooms: Record<string, WorkroomDefinition>): WorkroomDraft[] {
  return Object.entries(workrooms).map(([projectId, definition]) => ({
    ...copyDefinition(definition),
    projectId,
  }))
}

function toDefinitions(drafts: WorkroomDraft[]): Record<string, WorkroomDefinition> {
  return Object.fromEntries(drafts.map(({ projectId, ...definition }) => [projectId.trim(), definition]))
}

function emptyConversation(agent = ''): ConversationBinding {
  return { adapter: '', endpoint: '', kind: 'group', id: '', agent }
}

function nextProjectId(drafts: readonly WorkroomDraft[]): string {
  const ids = new Set(drafts.map((item) => item.projectId))
  let index = drafts.length + 1
  while (ids.has(`workroom-${index}`)) index += 1
  return `workroom-${index}`
}

const draftSessions = createWorkroomDraftSessions<{ catalog: WorkroomCatalog; drafts: WorkroomDraft[]; publishUnconfirmed?: boolean }>()
let unloadGuardInstalled = false
function ensureUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!draftSessions.hasUnsaved(getWebSocketManager())) return
    event.preventDefault()
    event.returnValue = ''
  })
}

export default function WorkroomCatalogPage() {
  const readOnly = isDemoMode()
  const connection = getWebSocketManager()
  const restoredDraft = useRef(readOnly ? undefined : draftSessions.get(connection))
  ensureUnloadGuard()
  const [catalog, setCatalog] = useState<WorkroomCatalog | null>(restoredDraft.current?.catalog ?? null)
  const [drafts, setDrafts] = useState<WorkroomDraft[]>(restoredDraft.current?.drafts ?? [])
  const [endpoints, setEndpoints] = useState<EndpointOption[]>([])
  const [endpointInventoryState, setEndpointInventoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(Boolean(restoredDraft.current))
  const [publishUnconfirmed, setPublishUnconfirmed] = useState(Boolean(restoredDraft.current?.publishUnconfirmed))
  const [error, setError] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const requestRef = useRef(0)
  const editVersionRef = useRef(0)
  const dirtyRef = useRef(Boolean(restoredDraft.current))
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const publishUnconfirmedRef = useRef(publishUnconfirmed)
  publishUnconfirmedRef.current = publishUnconfirmed

  const load = useCallback(async (discardDraft = false, retryFailedRead = false) => {
    if (dirtyRef.current && !discardDraft && !retryFailedRead) {
      setReloadOpen(true)
      return
    }
    const requestId = ++requestRef.current
    const editVersion = editVersionRef.current
    setLoading(true)
    setError(null)
    setCatalogError(null)
    setNotice(null)
    setEndpointInventoryState('loading')
    const endpointRequest = requestConsole<{ endpoints: EndpointOption[] }>({ type: ENDPOINT_RPC.LIST }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    )
    let catalogLoaded = false
    try {
      const next = await requestConsole<WorkroomCatalog>({ type: CONSOLE_RPC.WORKROOMS_GET })
      if (requestId !== requestRef.current || editVersion !== editVersionRef.current) return
      const reconciled = publishUnconfirmedRef.current && workroomDefinitionsMatch(next.workrooms, toDefinitions(draftsRef.current))
      if (dirtyRef.current && !discardDraft && !reconciled) {
        // Keep the original revision: publication must still detect external
        // changes rather than silently rebasing a retained draft.
        setNotice(publishUnconfirmedRef.current ? '最新配置与本地草稿不同，请核对后决定是否放弃修改。' : '连接已恢复，本地草稿已保留。')
      } else {
        setCatalog(next)
        setDrafts(toDrafts(next.workrooms))
        setDirty(false)
        setPublishUnconfirmed(false)
        dirtyRef.current = false
        if (reconciled) setNotice('已核对最新配置，发布成功。')
      }
      catalogLoaded = true
    } catch (caught) {
      if (requestId === requestRef.current) {
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(message)
        setCatalogError(message)
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
    if (!catalogLoaded) return

    const endpointResult = await endpointRequest
    if (requestId !== requestRef.current) return
    if (endpointResult.status === 'fulfilled') {
      setEndpoints(endpointResult.value.endpoints ?? [])
      setEndpointError(null)
      setEndpointInventoryState('ready')
    } else {
      setEndpointError(endpointResult.reason instanceof Error
        ? endpointResult.reason.message
        : String(endpointResult.reason))
      setEndpointInventoryState('error')
    }
  }, [])

  useEffect(() => {
    void load(!restoredDraft.current, true)
    return () => { requestRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (dirty && catalog && !readOnly) draftSessions.set(connection, { catalog, drafts, publishUnconfirmed })
    else draftSessions.clear(connection)
  }, [connection, catalog, drafts, dirty, readOnly, publishUnconfirmed])

  const availability = catalogAvailability({ hasCatalog: Boolean(catalog), loading, saving, error: catalogError, dirty, readOnly })

  const change = useCallback((updater: (current: WorkroomDraft[]) => WorkroomDraft[]) => {
    editVersionRef.current += 1
    dirtyRef.current = true
    setDrafts(updater)
    setDirty(true)
    setNotice(null)
  }, [])

  const spaceIssues = validateWorkroomSpaceOwnership(drafts)
  const messageRouteIssues = drafts.map((draft, index) => [...validateWorkroomMessageRoutes(
    draft.members,
    endpoints,
    { validateKnownEndpoints: endpointInventoryState === 'ready' },
  ), ...spaceIssues[index].members])
  const firstMessageRouteIssue = messageRouteIssues.flat()[0]
  const sponsorIssues = validateWorkroomSponsors(drafts)
  const firstSponsorIssue = sponsorIssues[0]
  const projectIdIssues = validateWorkroomProjectIds(drafts)
  const firstProjectIdIssue = projectIdIssues.find(Boolean)
  const basicIssues = drafts.map((draft, index) => {
    const basic = validateWorkroomBasics(draft, endpoints, endpointInventoryState === "ready")
    return { ...basic,
      conversation: { ...basic.conversation, ...(spaceIssues[index].conversation ? {id: basic.conversation.id ?? spaceIssues[index].conversation} : {}) },
      sponsorConversation: { ...basic.sponsorConversation, ...(spaceIssues[index].sponsorConversation ? {id: basic.sponsorConversation.id ?? spaceIssues[index].sponsorConversation} : {}) },
    }
  })
  const firstBasicIssue = basicIssues.flatMap(issue => [issue.name, ...Object.values(issue.conversation), ...Object.values(issue.sponsorConversation)]).find(Boolean)

  const memberIssues = drafts.map(draft => validateWorkroomMembers(draft, Object.keys(catalog?.agents ?? {})))
  const firstMemberIssue = memberIssues.flatMap(issue => [issue.orchestrator, ...issue.members.flatMap(row => Object.values(row))]).find(Boolean)

  const save = async () => {
    if (!availability.canPublish || !catalog || publishUnconfirmed) return
    if (firstProjectIdIssue) return setError(firstProjectIdIssue)
    if (firstBasicIssue) return setError(firstBasicIssue)
    if (firstMemberIssue) return setError(firstMemberIssue)
    if (firstSponsorIssue) return setError(firstSponsorIssue.message)
    if (firstMessageRouteIssue) return setError(`消息出口配置不可发布：${firstMessageRouteIssue.message}`)
    const editVersion = editVersionRef.current
    const viewRequestId = requestRef.current
    const definitions = toDefinitions(drafts)
    const applyPublished = (next: WorkroomCatalog, recovered = false) => {
      setCatalog(next)
      setPublishUnconfirmed(false)
      setError(null)
      if (editVersion !== editVersionRef.current) {
        setNotice('配置已发布，本地还有新的修改。')
        return
      }
      setDrafts(toDrafts(next.workrooms))
      setDirty(false)
      dirtyRef.current = false
      setNotice(recovered ? '已核对最新配置，发布成功。' : '配置已发布。')
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await requestConsole<{ success: true; revision: string; restartRequired: false }>({
        type: CONSOLE_RPC.WORKROOMS_SET,
        data: definitions,
        expectedRevision: catalog.revision,
      })
      if (viewRequestId !== requestRef.current) return
      applyPublished({ ...catalog, workrooms: definitions, revision: result.revision })
    } catch (caught) {
      if (viewRequestId !== requestRef.current) return
      // An error response can follow a committed write. Reconcile by reading;
      // never retry publication without the authoritative revision.
      try {
        const next = await requestConsole<WorkroomCatalog>({ type: CONSOLE_RPC.WORKROOMS_GET })
        if (viewRequestId !== requestRef.current) return
        if (workroomDefinitionsMatch(next.workrooms, definitions)) {
          applyPublished(next, true)
          return
        }
      } catch {
        // Keep the original draft and base when the verification read fails.
      }
      if (viewRequestId !== requestRef.current) return
      setPublishUnconfirmed(true)
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (viewRequestId === requestRef.current) setSaving(false)
    }
  }

  const agentNames = useMemo(() => Object.keys(catalog?.agents ?? {}), [catalog])
  const endpointCount = new Set(drafts.flatMap((item) => [
    item.conversation,
    item.sponsorConversation,
    ...item.members.map((member) => member.messageRoute),
  ]
    .filter((binding): binding is ConversationBinding | WorkroomMessageRoute => Boolean(binding))
    .map((binding) => `${binding.adapter}:${binding.endpoint}`))).size

  return (
    <PageShell className="max-w-[1680px]">
      <PageHeader
        title="Workroom 配置"
        description="配置协作空间、成员和消息渠道。"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/agent/workrooms"><LayoutDashboard />任务看板</Link></Button>
            <Button variant="outline" size="sm" disabled={loading || saving} onClick={() => void load(false)}><RefreshCw className={loading ? 'animate-spin' : ''} />刷新</Button>
            {!readOnly ? <Button size="sm" disabled={!availability.canPublish || publishUnconfirmed || Boolean(firstProjectIdIssue || firstBasicIssue || firstMemberIssue || firstMessageRouteIssue || firstSponsorIssue)} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? '发布中' : '发布目录'}</Button> : null}
          </div>
        }
      />

      {readOnly ? <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Demo 只读展示目录；发布仅在私有 full 模式开放。</div> : null}
      {error || publishUnconfirmed ? <ErrorAlert error={publishUnconfirmed ? '未能确认发布结果。本地草稿已保留，请刷新并核对最新配置。' : error ?? ''} onRetry={catalogError || publishUnconfirmed ? () => load(false, true) : undefined} /> : null}
      {error && publishUnconfirmed ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">错误详情</summary><pre className="mt-2 whitespace-pre-wrap break-words">{error}</pre></details> : null}
      {!loading && !catalog ? <EmptyState title="Workroom 目录未就绪" description="尚未取得目录，暂不能新建、编辑或发布。请先在 Host 安装并配置可选 Workroom Catalog 服务及 Agent，再刷新；无需重建本地草稿。" /> : null}
      {catalog && catalogError ? <div className="rounded-lg border bg-muted/25 px-4 py-3 text-sm text-muted-foreground">刷新失败，以下是上次成功加载的目录；本地修改仍保留，恢复目录连接前暂停编辑和发布。</div> : null}
      {dirty ? <Button variant="outline" size="sm" disabled={loading || saving} onClick={() => setReloadOpen(true)}>放弃未发布修改</Button> : null}
      {endpointError ? <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Endpoint 列表暂不可用；Catalog 仍可查看和编辑，已有消息出口会保持原值。发布时 Runtime 仍会执行最终校验。</div> : null}
      {notice ? <div className="rounded-lg border bg-muted/25 px-4 py-3 text-sm text-muted-foreground">{notice}</div> : null}

      {loading && !catalog ? (
        <div className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
      ) : catalog ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workroom Catalog 摘要">
            <Metric icon={Boxes} label="Workrooms" value={drafts.length} detail={`${drafts.filter((item) => item.enabled !== false).length} 个已启用`} />
            <Metric icon={Bot} label="Bot Endpoints" value={endpointCount} detail="一个 Endpoint 可服务多个 Workroom" />
            <Metric icon={UsersRound} label="Agents" value={agentNames.length} detail="来自当前 Agent generation" />
            <Metric icon={Database} label="Revision" value={catalog?.revision.slice(0, 8) ?? '—'} detail={availability.revisionDetail} />
          </section>

          <div className="space-y-4">
            {drafts.map((draft, index) => (
              <WorkroomEditor
                key={index}
                value={draft}
                projectIdIssue={projectIdIssues[index]}
                basicIssues={basicIssues[index]}
                memberIssues={memberIssues[index]}
                sponsorIssue={sponsorIssues.find(issue => issue.projectId === draft.projectId)?.message}
                persisted={Object.hasOwn(catalog.workrooms, draft.projectId)}
                agents={agentNames}
                agentDetails={catalog?.agents ?? {}}
                endpoints={endpoints}
                messageRouteIssues={new Map(messageRouteIssues[index]?.map((issue) => [issue.memberIndex, issue]))}
                readOnly={!availability.canEdit}
                onChange={(next) => change((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))}
                onDelete={() => change((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              />
            ))}
            {!drafts.length ? <EmptyState title="尚未配置 Workroom" description="创建第一个 Project，将协作空间绑定到 Orchestrator Agent。" /> : null}
            {!readOnly ? (
              <Button variant="outline" disabled={!availability.canEdit} className="w-full border-dashed py-7" onClick={() => change((current) => {
                const agent = agentNames[0] ?? ''
                return [...current, createNewWorkroomDraft({
                  projectId: nextProjectId(current),
                  agent,
                  principalId: catalog?.principalId,
                })]
              })}><Plus />新建 Workroom</Button>
            ) : null}
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={reloadOpen}
        onOpenChange={setReloadOpen}
        title="载入最新配置？"
        description="载入成功后将替换本地未发布修改；读取失败时会保留草稿。"
        cancelLabel="继续编辑"
        confirmLabel="放弃修改并载入"
        onConfirm={() => load(true)}
      />
    </PageShell>
  )
}

function WorkroomEditor(props: {
  value: WorkroomDraft
  projectIdIssue: string | null
  basicIssues: BasicIssues
  memberIssues: WorkroomMemberIssues
  sponsorIssue?: string
  persisted: boolean
  agents: string[]
  agentDetails: WorkroomCatalog['agents']
  endpoints: EndpointOption[]
  messageRouteIssues: ReadonlyMap<number, MessageRouteIssue>
  readOnly: boolean
  onChange(value: WorkroomDraft): void
  onDelete(): void
}) {
  const { value, readOnly } = props
  const projectIdErrorId = useId()
  const nameErrorId = useId()
  const memberErrorId = useId()
  const sponsorErrorId = useId()
  const patch = (next: Partial<WorkroomDraft>) => props.onChange({ ...value, ...next })
  const setMember = (index: number, member: WorkroomMember) => patch({ members: value.members.map((item, itemIndex) => itemIndex === index ? member : item) })
  const orchestrators = value.members.filter((member) => member.role === 'orchestrator').map((member) => member.agent)
  const messageRouteOwners = new Map<string, string>()
  for (const member of value.members) {
    if (!member.messageRoute) continue
    messageRouteOwners.set(endpointRouteKey(member.messageRoute), member.agent)
  }

  return (
    <article className={cn('console-dashboard-panel overflow-hidden', value.enabled === false && 'opacity-80')}>
      <header className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(10rem,0.35fr)_minmax(14rem,0.65fr)]">
          <div>
            <Field label="Project ID"><Input value={value.projectId} required aria-invalid={Boolean(props.projectIdIssue)} aria-describedby={props.projectIdIssue ? projectIdErrorId : undefined} disabled={readOnly} onChange={(event) => patch({ projectId: event.target.value })} placeholder="project-alpha" /></Field>
            {props.projectIdIssue ? <p id={projectIdErrorId} className="mt-1 text-xs text-destructive">{props.projectIdIssue}</p> : null}
          </div>
          <div><Field label="名称"><Input value={value.name} required aria-invalid={Boolean(props.basicIssues.name)} aria-describedby={props.basicIssues.name ? nameErrorId : undefined} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} placeholder="协作项目名称" /></Field>{props.basicIssues.name ? <p id={nameErrorId} className="mt-1 text-xs text-destructive">{props.basicIssues.name}</p> : null}</div>
        </div>
        <div className="flex items-center gap-2">
          {props.persisted ? <Button asChild variant="outline" size="sm"><Link to={`/agent/workrooms?projectId=${encodeURIComponent(value.projectId.trim())}`}><LayoutDashboard />查看任务</Link></Button> : null}
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled !== false} disabled={readOnly} onChange={(event) => patch({ enabled: event.target.checked })} />启用</label>
          {!readOnly ? <Button variant="ghost" size="icon" aria-label={`删除 ${value.projectId}`} onClick={props.onDelete}><Trash2 /></Button> : null}
        </div>
      </header>

      <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <div className="space-y-4">
          <Field label="说明"><Textarea value={value.description ?? ''} disabled={readOnly} onChange={(event) => patch({ description: event.target.value || undefined })} placeholder="这个 Workroom 负责什么？" className="min-h-20" /></Field>
          <ConversationEditor title="主协作空间" required mandatory={value.enabled !== false} issues={props.basicIssues.conversation} value={value.conversation} endpoints={props.endpoints} orchestrators={orchestrators} readOnly={readOnly} onChange={(conversation) => patch({ conversation })} />
          <ConversationEditor title="Sponsor Room" issues={props.basicIssues.sponsorConversation} value={value.sponsorConversation} endpoints={props.endpoints} orchestrators={orchestrators} readOnly={readOnly} onChange={(sponsorConversation) => patch({ sponsorConversation })} />
          <Field label="负责人标识" hint="每行一位"><Textarea aria-invalid={Boolean(props.sponsorIssue)} aria-describedby={props.sponsorIssue ? sponsorErrorId : undefined} value={(value.sponsors ?? []).join('\n')} disabled={readOnly} onChange={(event) => patch({ sponsors: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} placeholder="github:user:octocat" className="min-h-20 font-mono text-xs" /></Field>
          {props.sponsorIssue ? <p id={sponsorErrorId} className="text-xs text-destructive">{props.sponsorIssue}</p> : null}
        </div>

        <section aria-labelledby={`members-${value.projectId}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h3 id={`members-${value.projectId}`} className="text-sm font-semibold">成员</h3><p className="mt-0.5 text-xs text-muted-foreground">选择参与项目的 Agent 和角色。</p></div>
            <Badge variant="outline">{value.members.length}</Badge>
          </div>
          {props.memberIssues.orchestrator ? <p className="mb-2 text-xs text-destructive">{props.memberIssues.orchestrator}</p> : null}
          <div className="space-y-3">
            {value.members.map((member, index) => (
              <div key={index} className="rounded-xl border bg-muted/[0.08] p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.55fr)_auto] sm:items-end">
                  <Field label="Agent"><NativeSelect value={member.agent} invalid={Boolean(props.memberIssues.members[index]?.agent)} describedBy={props.memberIssues.members[index]?.agent ? `${memberErrorId}-${index}-agent` : undefined} disabled={readOnly} onChange={(agent) => setMember(index, { ...member, agent })}><option value="">选择 Agent</option>{props.agents.map((agent) => <option key={agent} value={agent}>{props.agentDetails[agent]?.nickname || agent}</option>)}</NativeSelect></Field>
                  <Field label="Role"><NativeSelect value={member.role} invalid={Boolean(props.memberIssues.members[index]?.role)} describedBy={props.memberIssues.members[index]?.role ? `${memberErrorId}-${index}-role` : undefined} disabled={readOnly} onChange={(role) => setMember(index, { ...member, role: role as MemberRole })}>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</NativeSelect></Field>
                  {!readOnly ? <Button variant="ghost" size="icon" aria-label={`删除成员 ${index + 1}`} onClick={() => patch({ members: value.members.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></Button> : <span />}
                </div>

                {props.memberIssues.members[index]?.agent ? <p id={`${memberErrorId}-${index}-agent`} className="mt-1 text-xs text-destructive">{props.memberIssues.members[index].agent}</p> : null}
                {props.memberIssues.members[index]?.role ? <p id={`${memberErrorId}-${index}-role`} className="mt-1 text-xs text-destructive">{props.memberIssues.members[index].role}</p> : null}
                <MemberOptions initiallyOpen={member.assignmentRoute?.kind === "remote" || Boolean(member.messageRoute)} invalid={Boolean(props.memberIssues.members[index]?.endpointId || props.messageRouteIssues.get(index))}>
                <div className="grid gap-3 pt-3 lg:grid-cols-2">
                  <div className="rounded-lg border bg-background/70 p-3">
                    <div className="mb-3 flex items-start gap-2">
                      <Route className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div><h4 className="text-xs font-semibold">任务执行入口</h4><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">本机执行，或精确路由到远程 Agent Endpoint。</p></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Execution"><NativeSelect value={member.assignmentRoute?.kind ?? 'local'} disabled={readOnly} onChange={(kind) => setMember(index, { ...member, assignmentRoute: kind === 'remote' ? { kind: 'remote', endpointId: '' } : { kind: 'local' } })}><option value="local">local</option><option value="remote">remote</option></NativeSelect></Field>
                      <Field label="Remote Endpoint ID"><Input aria-invalid={Boolean(props.memberIssues.members[index]?.endpointId)} aria-describedby={props.memberIssues.members[index]?.endpointId ? `${memberErrorId}-${index}-remote` : undefined} value={member.assignmentRoute?.kind === 'remote' ? member.assignmentRoute.endpointId ?? '' : ''} disabled={readOnly || member.assignmentRoute?.kind !== 'remote'} onChange={(event) => setMember(index, { ...member, assignmentRoute: { kind: 'remote', endpointId: event.target.value } })} placeholder="worker-east" /></Field>
                    </div>
                    {props.memberIssues.members[index]?.endpointId ? <p id={`${memberErrorId}-${index}-remote`} className="mt-1 text-xs text-destructive">{props.memberIssues.members[index].endpointId}</p> : null}
                  </div>

                  <MessageRouteEditor
                    member={member}
                    primaryConversation={value.conversation}
                    endpoints={props.endpoints}
                    routeOwners={messageRouteOwners}
                    issue={props.messageRouteIssues.get(index)}
                    readOnly={readOnly}
                    onChange={(messageRoute) => setMember(index, { ...member, messageRoute })}
                  />
                </div>
                </MemberOptions>
              </div>
            ))}
            {!readOnly ? <Button variant="outline" size="sm" onClick={() => patch({ members: [...value.members, { agent: props.agents[0] ?? '', role: value.members.some((member) => member.role === 'orchestrator') ? 'executor' : 'orchestrator' }] })}><Plus />添加成员</Button> : null}
          </div>
        </section>
      </div>
    </article>
  )
}

function MemberOptions({ initiallyOpen, invalid, children }: { initiallyOpen: boolean; invalid: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen || invalid)
  useEffect(() => { if (invalid) setOpen(true) }, [invalid])
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="mt-3 border-t pt-3">
    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">执行与消息渠道</summary>
    {children}
  </details>
}

function MessageRouteEditor(props: {
  member: WorkroomMember
  primaryConversation?: ConversationBinding
  endpoints: EndpointOption[]
  routeOwners: ReadonlyMap<string, string>
  issue?: MessageRouteIssue
  readOnly: boolean
  onChange(value: WorkroomMessageRoute | undefined): void
}) {
  const { member } = props
  const routeValue = endpointRouteKey(member.messageRoute)
  const routeKnown = props.endpoints.some((endpoint) =>
    endpointRouteKey({ adapter: endpoint.adapter, endpoint: endpoint.name }) === routeValue)
  const inheritedEndpoint = props.primaryConversation
    ? `${props.primaryConversation.adapter}:${props.primaryConversation.endpoint}`
    : '尚未配置主空间'

  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <RadioTower className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h4 className="text-xs font-semibold">消息出口投影</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">选择该 Agent 在主协作空间发言时使用的 Bot 身份。</p>
          </div>
        </div>
        <Badge variant={props.issue ? 'destructive' : member.messageRoute ? 'outline' : 'secondary'}>
          {props.issue ? '需要修正' : member.messageRoute ? '独立出口' : '继承主空间'}
        </Badge>
      </div>
      <Field label="Projection Endpoint" hint={member.messageRoute
        ? `通过 ${member.messageRoute.adapter}:${member.messageRoute.endpoint} 投影`
        : `继承 ${inheritedEndpoint}`}>
        <NativeSelect value={routeValue} disabled={props.readOnly} invalid={Boolean(props.issue)} onChange={(selected) => {
          props.onChange(parseEndpointRouteKey(selected))
        }}>
          <option value="">继承主空间 Endpoint · {inheritedEndpoint}</option>
          {!routeKnown && member.messageRoute ? (
            <option value={routeValue}>{member.messageRoute.adapter}:{member.messageRoute.endpoint}{props.issue?.code === 'unknown' ? '（Endpoint 已失效）' : '（当前值）'}</option>
          ) : null}
          {props.endpoints.map((endpoint) => {
            const value = endpointRouteKey({ adapter: endpoint.adapter, endpoint: endpoint.name })
            const owner = props.routeOwners.get(value)
            const occupied = Boolean(owner && owner !== member.agent)
            return (
              <option key={`${endpoint.adapter}:${endpoint.name}`} value={value} disabled={occupied}>
                {endpoint.adapter}:{endpoint.name}
                {endpoint.connected ? ' · online' : ' · offline'}
                {occupied ? ` · 已由 ${owner} 使用` : ''}
              </option>
            )
          })}
        </NativeSelect>
      </Field>
      {props.issue ? <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{props.issue.message}</p> : null}
    </div>
  )
}

function ConversationEditor(props: {
  title: string
  issues: BindingIssues
  required?: boolean
  mandatory?: boolean
  value?: ConversationBinding
  endpoints: EndpointOption[]
  orchestrators: string[]
  readOnly: boolean
  onChange(value: ConversationBinding | undefined): void
}) {
  const errorId = useId()
  const enabled = Boolean(props.value)
  const value = props.value ?? emptyConversation(props.orchestrators[0])
  const patch = (next: Partial<ConversationBinding>) => props.onChange({ ...value, ...next })
  const kinds = props.title === 'Sponsor Room' ? SPACE_KINDS.filter((kind) => kind !== 'repository') : SPACE_KINDS
  const endpointValue = endpointRouteKey(value)
  const endpointKnown = props.endpoints.some((endpoint) => endpointRouteKey({ adapter: endpoint.adapter, endpoint: endpoint.name }) === endpointValue)
  return (
    <section className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><GitFork className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">{props.title}</h3>{props.mandatory ? <Badge variant="secondary">必填</Badge> : null}</div>
        {!props.required ? <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={enabled} disabled={props.readOnly} onChange={(event) => props.onChange(event.target.checked ? value : undefined)} />启用</label> : null}
      </div>
      {(enabled || props.required) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bot Endpoint">
            <NativeSelect value={endpointValue} invalid={Boolean(props.issues.endpoint)} describedBy={props.issues.endpoint ? `${errorId}-endpoint` : undefined} disabled={props.readOnly} onChange={(selected) => {
              const route = parseEndpointRouteKey(selected)
              patch(route ?? { adapter: '', endpoint: '' })
            }}>
              <option value={'\0'}>选择已配置 Endpoint</option>
              {!endpointKnown && value.adapter && value.endpoint ? <option value={endpointValue}>{value.adapter}:{value.endpoint}（当前值）</option> : null}
              {props.endpoints.map((endpoint) => <option key={`${endpoint.adapter}:${endpoint.name}`} value={endpointRouteKey({ adapter: endpoint.adapter, endpoint: endpoint.name })}>{endpoint.adapter}:{endpoint.name}{endpoint.connected ? ' · online' : ' · offline'}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Space Kind"><NativeSelect value={value.kind} disabled={props.readOnly} onChange={(kind) => patch({ kind: kind as SpaceKind })}>{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</NativeSelect></Field>
          <Field label={value.kind === 'repository' ? 'Repository' : 'Space ID'}><Input value={value.id} aria-invalid={Boolean(props.issues.id)} aria-describedby={props.issues.id ? `${errorId}-space` : undefined} disabled={props.readOnly} onChange={(event) => patch({ id: event.target.value })} placeholder={value.kind === 'repository' ? 'owner/repo' : 'channel-or-group-id'} /></Field>
          <Field label="Orchestrator Agent"><NativeSelect value={value.agent} invalid={Boolean(props.issues.agent)} describedBy={props.issues.agent ? `${errorId}-agent` : undefined} disabled={props.readOnly} onChange={(agent) => patch({ agent })}><option value="">选择 Orchestrator</option>{props.orchestrators.map((agent) => <option key={agent} value={agent}>{agent}</option>)}</NativeSelect></Field>
          {props.issues.endpoint ? <p id={`${errorId}-endpoint`} className="text-xs text-destructive sm:col-span-2">{props.issues.endpoint}</p> : null}
          {props.issues.id ? <p id={`${errorId}-space`} className="text-xs text-destructive sm:col-span-2">{props.issues.id}</p> : null}
          {props.issues.agent ? <p id={`${errorId}-agent`} className="text-xs text-destructive sm:col-span-2">{props.issues.agent}</p> : null}
        </div>
      ) : <p className="text-xs text-muted-foreground">未配置独立 Sponsor 控制空间。</p>}
    </section>
  )
}

function NativeSelect(props: { value: string; disabled?: boolean; invalid?: boolean; describedBy?: string; onChange(value: string): void; children: ReactNode }) {
  return <select aria-invalid={props.invalid || undefined} aria-describedby={props.describedBy} className={cn('h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.invalid && 'border-destructive focus-visible:ring-destructive')} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>{props.children}</select>
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">{props.label}{props.hint ? <span className="font-normal">· {props.hint}</span> : null}</span>{props.children}</label>
}

function Metric(props: { icon: typeof Boxes; label: string; value: number | string; detail: string }) {
  const Icon = props.icon
  return <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{props.label}</div><strong className="mt-2 block truncate text-2xl" title={String(props.value)}>{props.value}</strong><p className="mt-1 text-xs text-muted-foreground">{props.detail}</p></CardContent></Card>
}
