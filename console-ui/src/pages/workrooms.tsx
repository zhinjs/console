import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDot,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react'
import { cn, useWebSocket } from '@zhin.js/client'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Switch } from '../components/ui/switch'
import { apiFetch } from '../utils/auth'

type WorkroomRole = 'orchestrator' | 'executor' | 'reviewer' | 'integration'

interface WorkroomMember {
  agent: string
  role: WorkroomRole
}

type WorkroomSpaceKind = 'group' | 'channel' | 'repository'

interface WorkroomConversationBinding {
  adapter: string
  endpoint: string
  kind: WorkroomSpaceKind
  id: string
  agent: string
}

interface WorkroomDefinition {
  name: string
  description?: string
  enabled?: boolean
  members: WorkroomMember[]
  conversation?: WorkroomConversationBinding
  [key: string]: unknown
}

interface AgentBinding {
  provider?: string
  model?: string
  nickname?: string
}

interface EndpointInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
}

interface WorkroomTask {
  key: string
  title: string
  status: string
  currentAssignmentId?: string
  blockers?: unknown[]
}

interface WorkroomRun {
  runId: string
  projectId: string
  title: string
  status: string
  now: number
  tasks: Record<string, WorkroomTask>
}

const ROLE_META: Record<WorkroomRole, { label: string; description: string }> = {
  orchestrator: { label: 'Orchestrator', description: '拆解工作并协调成员' },
  executor: { label: 'Executor', description: '执行任务并提交产物' },
  reviewer: { label: 'Reviewer', description: '独立复核结果与证据' },
  integration: { label: 'Integration', description: '处理外部系统与交付' },
}

const ROLES = Object.keys(ROLE_META) as WorkroomRole[]

export default function WorkroomsPage() {
  const { connected, sendRequest } = useWebSocket()
  const editVersionRef = useRef(0)
  const runsAbortRef = useRef<AbortController | null>(null)
  const [agents, setAgents] = useState<Record<string, AgentBinding>>({})
  const [workrooms, setWorkrooms] = useState<Record<string, WorkroomDefinition>>({})
  const [revision, setRevision] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([])
  const [view, setView] = useState<'topology' | 'runs'>('topology')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [runs, setRuns] = useState<WorkroomRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState<string | null>(null)

  const selected = selectedId ? workrooms[selectedId] : undefined
  const validation = useMemo(() => validateWorkroom(selectedId, selected, agents, endpoints), [agents, endpoints, selected, selectedId])

  const loadCatalog = useCallback(async () => {
    if (!connected) return
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const result = await sendRequest<{ agents?: unknown; workrooms?: unknown; revision?: string }>({ type: 'workrooms:get' })
      const nextWorkrooms = normalizeWorkrooms(result.workrooms)
      setAgents(normalizeAgents(result.agents))
      setWorkrooms(nextWorkrooms)
      setRevision(result.revision ?? '')
      setSelectedId((current) => current && nextWorkrooms[current] ? current : Object.keys(nextWorkrooms)[0] ?? '')
      setDirty(false)
      editVersionRef.current += 1
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error))
    } finally {
      setCatalogLoading(false)
    }
  }, [connected, sendRequest])

  useEffect(() => { void loadCatalog() }, [loadCatalog])

  const loadEndpoints = useCallback(async () => {
    if (!connected) return
    try {
      const result = await sendRequest<{ endpoints?: EndpointInfo[] }>({ type: 'endpoint:list' })
      setEndpoints(result.endpoints ?? [])
    } catch {
      setEndpoints([])
    }
  }, [connected, sendRequest])

  useEffect(() => {
    void loadEndpoints()
  }, [loadEndpoints])

  const loadRuns = useCallback(async () => {
    if (!selectedId) return
    runsAbortRef.current?.abort()
    const controller = new AbortController()
    runsAbortRef.current = controller
    setRunsLoading(true)
    setRunsError(null)
    try {
      const response = await apiFetch(`/api/agent/workroom/runs?projectId=${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      const body = await response.json() as {
        success?: boolean
        error?: string
        data?: { runs?: WorkroomRun[] }
      }
      if (!response.ok || body.success === false) throw new Error(body.error ?? `HTTP ${response.status}`)
      setRuns(body.data?.runs ?? [])
    } catch (error) {
      if (controller.signal.aborted) return
      setRuns([])
      setRunsError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!controller.signal.aborted) setRunsLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    setRuns([])
    setRunsError(null)
    if (view === 'runs' && selectedId) void loadRuns()
    return () => runsAbortRef.current?.abort()
  }, [loadRuns, selectedId, view])

  const updateSelected = useCallback((updater: (current: WorkroomDefinition) => WorkroomDefinition) => {
    if (!selectedId) return
    setWorkrooms((current) => ({ ...current, [selectedId]: updater(current[selectedId]!) }))
    editVersionRef.current += 1
    setDirty(true)
    setNotice(null)
  }, [selectedId])

  const createWorkroom = () => {
    const id = newId.trim()
    const name = newName.trim()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id) || !name || workrooms[id]) return
    const firstAgent = Object.keys(agents)[0]
    const definition: WorkroomDefinition = {
      name,
      enabled: false,
      members: firstAgent ? [{ agent: firstAgent, role: 'orchestrator' }] : [],
    }
    setWorkrooms((current) => ({ ...current, [id]: definition }))
    setSelectedId(id)
    setCreating(false)
    setNewId('')
    setNewName('')
    setDirty(true)
    editVersionRef.current += 1
    setNotice(null)
  }

  const removeWorkroom = () => {
    if (!selectedId || !selected) return
    if (!window.confirm(`删除 Workroom「${selected.name}」的配置？运行 Journal 不会被删除。`)) return
    setWorkrooms((current) => {
      const next = { ...current }
      delete next[selectedId]
      setSelectedId(Object.keys(next)[0] ?? '')
      return next
    })
    setDirty(true)
    editVersionRef.current += 1
    setNotice(null)
  }

  const saveWorkrooms = async () => {
    const problems = Object.entries(workrooms).flatMap(([id, workroom]) =>
      validateWorkroom(id, workroom, agents, endpoints).map((problem) => `${id}: ${problem}`))
    const addresses = new Map<string, string>()
    for (const [id, workroom] of Object.entries(workrooms)) {
      if (workroom.enabled === false || !workroom.conversation) continue
      const address = conversationAddress(workroom.conversation)
      const owner = addresses.get(address)
      if (owner) problems.push(`${id}: 与 ${owner} 重复绑定同一协作空间`)
      else addresses.set(address, id)
    }
    if (problems.length) {
      setNotice(`保存前请修正：${problems[0]}`)
      return
    }
    setSaving(true)
    setNotice(null)
    const savingVersion = editVersionRef.current
    try {
      const result = await sendRequest<{ revision?: string }>({
        type: 'workrooms:set',
        data: workrooms,
        expectedRevision: revision,
      })
      setRevision(result.revision ?? revision)
      if (editVersionRef.current === savingVersion) setDirty(false)
      setNotice('Workroom Catalog 已保存并立即生效，无需重启 Host。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell className="max-w-[1600px]">
      <PageHeader
        title="Workroom 看板"
        description="以群、频道或 GitHub 仓库为协作边界，配置入口 Endpoint、Agent 与角色；Task 是运行事实视图。"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={dirty ? 'warning' : 'outline'}>{dirty ? '有未保存更改' : 'Catalog 已同步'}</Badge>
            <Button disabled={!dirty || saving || catalogLoading} onClick={() => void saveWorkrooms()}>
              {saving ? <RefreshCw className="animate-spin" /> : <Save />}
              保存 Catalog
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border border-primary/15 bg-primary/[0.035] px-4 py-3 text-sm text-muted-foreground">
        <strong className="text-foreground">关系模型：</strong>{' '}
        Workroom（projectId）绑定一个完整协作空间；Agent 成员承担 Orchestrator / Executor / Reviewer / Integration 角色；同一 Bot/App Endpoint 可服务多个不同空间。
      </div>

      {catalogError || notice ? (
        <div className={cn('rounded-lg border px-3 py-2 text-sm',
          catalogError || notice?.startsWith('保存前')
            ? 'border-destructive/25 bg-destructive/5 text-destructive'
            : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300')}>
          {catalogError ?? notice}
        </div>
      ) : null}

      <div className="grid min-h-[660px] gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold">Workroom 列表</p>
              <p className="text-xs text-muted-foreground">{Object.keys(workrooms).length} 个 Project</p>
            </div>
            <Button variant="outline" size="icon" aria-label="新建 Workroom" onClick={() => setCreating(true)}>
              <Plus />
            </Button>
          </div>

          {creating ? (
            <div className="mb-3 space-y-2 rounded-lg border bg-muted/25 p-3">
              <Input aria-label="新 Workroom Project ID" value={newId} onChange={(event) => setNewId(event.target.value.toLowerCase())} placeholder="project-id" />
              <Input aria-label="新 Workroom 名称" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Workroom 名称" />
              <p className="text-[11px] text-muted-foreground">projectId 创建后保持稳定，用于 Journal 与 Run 查询。</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={createWorkroom}>创建</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>取消</Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {Object.entries(workrooms).map(([id, workroom]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedId(id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  id === selectedId ? 'border-primary/35 bg-primary/[0.06]' : 'border-transparent bg-muted/25 hover:bg-muted/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{workroom.name}</span>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', workroom.enabled === false ? 'bg-muted-foreground/40' : 'bg-emerald-500')} />
                </div>
                <code className="mt-1 block truncate text-[11px] text-muted-foreground">{id}</code>
                <div className="mt-2 flex gap-2 text-[11px] text-muted-foreground">
                  <span>{workroom.conversation ? `${spaceKindLabel(workroom.conversation.kind)} · ${workroom.conversation.id}` : '未绑定空间'}</span>
                  <span>·</span>
                  <span>{workroom.members.length} Members</span>
                </div>
              </button>
            ))}
            {!catalogLoading && Object.keys(workrooms).length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                尚未配置 Workroom
              </div>
            ) : null}
          </div>
        </aside>

        {!selected ? (
          <Card className="grid place-items-center">
            <CardContent className="max-w-md p-8 text-center">
              <Boxes className="mx-auto mb-4 h-12 w-12 text-muted-foreground/35" />
              <h2 className="text-lg font-semibold">创建第一个 Workroom</h2>
              <p className="mt-2 text-sm text-muted-foreground">先定义 Project 边界，再加入 Agent 成员并绑定群、频道或 GitHub 仓库。</p>
              <Button className="mt-5" onClick={() => setCreating(true)}><Plus />新建 Workroom</Button>
            </CardContent>
          </Card>
        ) : (
          <main className="min-w-0 rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                  <Badge variant={selected.enabled === false ? 'secondary' : 'success'}>{selected.enabled === false ? '停用' : '启用'}</Badge>
                </div>
                <code className="text-xs text-muted-foreground">projectId: {selectedId}</code>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1" role="tablist" aria-label="Workroom 视图">
                <Button role="tab" aria-selected={view === 'topology'} size="sm" variant={view === 'topology' ? 'secondary' : 'ghost'} onClick={() => setView('topology')}><Network />配置关系</Button>
                <Button role="tab" aria-selected={view === 'runs'} size="sm" variant={view === 'runs' ? 'secondary' : 'ghost'} onClick={() => setView('runs')}><Workflow />运行任务</Button>
              </div>
            </div>

            {view === 'topology' ? (
              <TopologyEditor
                projectId={selectedId}
                workroom={selected}
                agents={agents}
                endpoints={endpoints}
                validation={validation}
                onChange={updateSelected}
                onRemove={removeWorkroom}
                onReloadEndpoints={() => void loadEndpoints()}
              />
            ) : (
              <RunsView runs={runs} loading={runsLoading} error={runsError} onRefresh={() => void loadRuns()} />
            )}
          </main>
        )}
      </div>
    </PageShell>
  )
}

function TopologyEditor(props: {
  projectId: string
  workroom: WorkroomDefinition
  agents: Record<string, AgentBinding>
  endpoints: EndpointInfo[]
  validation: string[]
  onChange(updater: (current: WorkroomDefinition) => WorkroomDefinition): void
  onRemove(): void
  onReloadEndpoints(): void
}) {
  const { workroom, agents, endpoints, onChange } = props
  const agentNames = Object.keys(agents)
  const memberAgentNames = Array.from(new Set(workroom.members.map((member) => member.agent)))
  const orchestratorAgentNames = Array.from(new Set(workroom.members
    .filter((member) => member.role === 'orchestrator')
    .map((member) => member.agent)))

  const addMember = () => {
    const agent = agentNames.find((name) => !workroom.members.some((member) => member.agent === name && member.role === 'executor'))
      ?? agentNames[0]
    if (!agent) return
    onChange((current) => ({ ...current, members: [...current.members, { agent, role: 'executor' }] }))
  }

  const bindSpace = () => {
    const endpoint = endpoints[0]
    const agent = orchestratorAgentNames[0]
    if (!endpoint || !agent) return
    onChange((current) => ({
      ...current,
      conversation: { adapter: endpoint.adapter, endpoint: endpoint.name, kind: 'group', id: '', agent },
    }))
  }

  return (
    <div className="space-y-6 p-5">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">名称</span>
            <Input value={workroom.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <div className="space-y-1.5 text-sm">
            <span className="font-medium">Project ID</span>
            <div className="flex h-9 items-center rounded-md border bg-muted/25 px-3 font-mono text-xs text-muted-foreground">{props.projectId}</div>
          </div>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">用途说明</span>
            <Textarea rows={2} value={workroom.description ?? ''} onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} placeholder="这个 Workroom 负责什么，谁使用，交付边界是什么…" />
          </label>
        </div>
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">启用 Workroom</p><p className="text-xs text-muted-foreground">停用后保留配置和历史</p></div>
            <Switch aria-label="启用 Workroom" checked={workroom.enabled !== false} onCheckedChange={(checked) => onChange((current) => ({ ...current, enabled: checked }))} />
          </div>
          <div className="mt-4 border-t pt-4">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={props.onRemove}><Trash2 />删除配置</Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-muted/[0.12] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Network className="h-4 w-4" />协作空间 → Agent 拓扑</h3>
            <p className="mt-1 text-xs text-muted-foreground">Workroom 绑定完整空间地址；同一个 Bot/App Endpoint 可以服务多个群、频道或仓库。</p>
          </div>
          <Button variant="outline" size="sm" onClick={props.onReloadEndpoints}><RefreshCw />刷新 Bot 状态</Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_56px_minmax(0,1.1fr)]">
          <div className="space-y-2">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Collaboration space</span><Badge variant="outline">{workroom.conversation ? '1' : '0'}</Badge></div>
            {workroom.conversation ? (() => {
              const space = workroom.conversation
              const live = endpoints.find((endpoint) => endpoint.adapter === space.adapter && endpoint.name === space.endpoint)
              const selectedEndpointKey = live ? endpointKey(live) : ''
              return (
                <div className="rounded-lg border bg-background p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className={cn('rounded-md p-2', live?.connected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}><Bot className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{spaceKindLabel(space.kind)} · {space.id || '待填写 ID'}</p><span className={cn('h-2 w-2 rounded-full', live?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/30')} /></div>
                      <label className="block text-[11px] text-muted-foreground">Bot / App Endpoint
                        <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={selectedEndpointKey} onChange={(event) => {
                          const endpoint = endpoints.find((item) => endpointKey(item) === event.target.value)
                          if (!endpoint) return
                          onChange((current) => ({ ...current, conversation: current.conversation ? {
                            ...current.conversation,
                            adapter: endpoint.adapter,
                            endpoint: endpoint.name,
                            kind: endpoint.adapter.includes('github') ? 'repository' : current.conversation.kind === 'repository' ? 'group' : current.conversation.kind,
                          } : undefined }))
                        }}>
                          {!live ? <option value="">{space.endpoint} · {space.adapter} · 未发现</option> : null}
                          {endpoints.map((endpoint) => <option key={endpointKey(endpoint)} value={endpointKey(endpoint)}>{endpoint.name} · {endpoint.adapter}{endpoint.connected ? ' · 在线' : ''}</option>)}
                        </select>
                      </label>
                      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                        <label className="text-[11px] text-muted-foreground">空间类型
                          <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={space.kind} onChange={(event) => onChange((current) => ({ ...current, conversation: current.conversation ? { ...current.conversation, kind: event.target.value as WorkroomSpaceKind } : undefined }))}>
                            <option value="group">群</option><option value="channel">频道</option><option value="repository">GitHub 仓库</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-muted-foreground">{space.kind === 'repository' ? 'owner/repo' : '群/频道 ID'}
                          <Input className="mt-1 h-8 text-xs" value={space.id} onChange={(event) => onChange((current) => ({ ...current, conversation: current.conversation ? { ...current.conversation, id: event.target.value } : undefined }))} placeholder={space.kind === 'repository' ? 'zhinjs/zhin' : '平台原始 sceneId'} />
                        </label>
                      </div>
                      <label className="block text-[11px] text-muted-foreground">入口 Agent
                        <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={space.agent} onChange={(event) => onChange((current) => ({ ...current, conversation: current.conversation ? { ...current.conversation, agent: event.target.value } : undefined }))}>
                          {orchestratorAgentNames.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                        </select>
                      </label>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="解除协作空间绑定" onClick={() => onChange((current) => ({ ...current, conversation: undefined, enabled: false }))}><Trash2 /></Button>
                  </div>
                </div>
              )
            })() : <EmptyMini icon={Bot} text="尚未绑定群、频道或仓库" />}
            {!workroom.conversation ? <Button variant="outline" size="sm" className="w-full" disabled={!endpoints.length || !orchestratorAgentNames.length} onClick={bindSpace}><Plus />绑定协作空间</Button> : null}
          </div>

          <div className="hidden items-center justify-center lg:flex"><div className="flex w-full items-center text-primary/45"><div className="h-px flex-1 bg-current" /><ArrowRight className="h-5 w-5" /></div></div>

          <div className="space-y-2">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent members</span><Badge variant="outline">{workroom.members.length}</Badge></div>
            {workroom.members.map((member, index) => {
              const binding = agents[member.agent]
              const isUsed = workroom.conversation?.agent === member.agent
              const hasAnotherMembership = workroom.members.some((item, itemIndex) => itemIndex !== index && item.agent === member.agent)
              return (
                <div key={`${member.agent}:${member.role}:${index}`} className="rounded-lg border bg-background p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary"><CircleDot className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{binding?.nickname || member.agent}</p>{isUsed ? <Badge variant="secondary">空间入口</Badge> : null}</div>
                      <p className="truncate text-xs text-muted-foreground">{binding?.provider ?? 'unknown'} · {binding?.model ?? '未配置模型'}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-muted-foreground">Agent
                          <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={member.agent} onChange={(event) => onChange((current) => {
                            const stillHasOldAgent = current.members.some((item, itemIndex) => itemIndex !== index && item.agent === member.agent)
                            return {
                              ...current,
                              members: current.members.map((item, itemIndex) => itemIndex === index ? { ...item, agent: event.target.value } : item),
                              conversation: !stillHasOldAgent && current.conversation?.agent === member.agent
                                ? { ...current.conversation, agent: event.target.value }
                                : current.conversation,
                            }
                          })}>
                            {Object.keys(agents).map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] text-muted-foreground">角色
                          <select className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={member.role} onChange={(event) => onChange((current) => ({ ...current, members: current.members.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value as WorkroomRole } : item) }))}>
                            {ROLES.map((role) => <option key={role} value={role}>{ROLE_META[role].label}</option>)}
                          </select>
                        </label>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{ROLE_META[member.role].description}</p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="移除 Agent 成员" disabled={isUsed && !hasAnotherMembership} title={isUsed && !hasAnotherMembership ? '先把协作空间改绑到其他 Agent' : undefined} onClick={() => onChange((current) => ({ ...current, members: current.members.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></Button>
                  </div>
                </div>
              )
            })}
            {workroom.members.length === 0 ? <EmptyMini icon={Users} text="尚未添加 Agent 成员" /> : null}
            <Button variant="outline" size="sm" className="w-full" disabled={!agentNames.length} onClick={addMember}><Plus />添加 Agent 成员</Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={ShieldCheck} title="角色隔离" value={`${new Set(workroom.members.map((member) => member.role)).size}/4`} description="成员承担的 Workroom 角色" />
        <SummaryCard icon={Bot} title="空间入口" value={workroom.conversation && endpoints.some((endpoint) => endpoint.adapter === workroom.conversation?.adapter && endpoint.name === workroom.conversation.endpoint && endpoint.connected) ? 'Online' : 'Offline'} description={workroom.conversation ? `${spaceKindLabel(workroom.conversation.kind)} · ${workroom.conversation.id || '待填写'}` : '尚未绑定协作空间'} />
        <SummaryCard icon={CheckCircle2} title="配置检查" value={props.validation.length ? `${props.validation.length} 项待修正` : 'Ready'} description={props.validation[0] ?? '成员、角色与协作空间引用完整'} tone={props.validation.length ? 'warning' : 'success'} />
      </section>
    </div>
  )
}

function RunsView(props: { runs: WorkroomRun[]; loading: boolean; error: string | null; onRefresh(): void }) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">运行任务</h3><p className="text-xs text-muted-foreground">这里读取 Journal + CAS Kernel 的事实，不编辑 Task 状态。</p></div>
        <Button variant="outline" size="sm" disabled={props.loading} onClick={props.onRefresh}><RefreshCw className={props.loading ? 'animate-spin' : ''} />刷新</Button>
      </div>
      {props.error ? <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{props.error}</div> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {props.runs.map((run) => (
          <Card key={run.runId}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3"><div><h4 className="font-medium">{run.title || '未命名 Run'}</h4><code className="text-[11px] text-muted-foreground">{run.runId}</code></div><Badge variant={/completed/u.test(run.status) ? 'success' : 'secondary'}>{run.status}</Badge></div>
              <div className="mt-4 space-y-2">
                {Object.values(run.tasks).map((task) => (
                  <div key={task.key} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                    <div className="min-w-0"><p className="truncate font-medium">{task.title}</p><code className="text-[10px] text-muted-foreground">{task.key}</code></div>
                    <Badge variant="outline">{task.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!props.loading && !props.error && props.runs.length === 0 ? <EmptyMini icon={Workflow} text="这个 Workroom 还没有 Run" /> : null}
    </div>
  )
}

function SummaryCard(props: { icon: typeof Bot; title: string; value: string; description: string; tone?: 'success' | 'warning' }) {
  const Icon = props.icon
  return <div className="rounded-xl border p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{props.title}</div><p className={cn('mt-2 text-xl font-semibold', props.tone === 'success' && 'text-emerald-600', props.tone === 'warning' && 'text-amber-600')}>{props.value}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={props.description}>{props.description}</p></div>
}

function EmptyMini(props: { icon: typeof Bot; text: string }) {
  const Icon = props.icon
  return <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{props.text}</div>
}

function normalizeAgents(value: unknown): Record<string, AgentBinding> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, binding]) => binding && typeof binding === 'object' && !Array.isArray(binding))) as Record<string, AgentBinding>
}

function endpointKey(endpoint: Pick<EndpointInfo, 'adapter' | 'name'>): string {
  return `${encodeURIComponent(endpoint.adapter)}:${encodeURIComponent(endpoint.name)}`
}

function normalizeWorkrooms(value: unknown): Record<string, WorkroomDefinition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = Object.create(null) as Record<string, WorkroomDefinition>
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const workroom = raw as Partial<WorkroomDefinition>
    result[id] = {
      ...workroom,
      name: typeof workroom.name === 'string' ? workroom.name : id,
      ...(typeof workroom.description === 'string' ? { description: workroom.description } : {}),
      enabled: workroom.enabled !== false,
      members: Array.isArray(workroom.members) ? workroom.members.filter(isMember).map((member) => ({ ...member })) : [],
      ...(isConversationBinding(workroom.conversation) ? { conversation: { ...workroom.conversation } } : { conversation: undefined }),
    }
  }
  return result
}

function isMember(value: unknown): value is WorkroomMember {
  if (!value || typeof value !== 'object') return false
  const member = value as Partial<WorkroomMember>
  return typeof member.agent === 'string' && ROLES.includes(member.role as WorkroomRole)
}

function isConversationBinding(value: unknown): value is WorkroomConversationBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Partial<WorkroomConversationBinding>
  return typeof binding.adapter === 'string'
    && typeof binding.endpoint === 'string'
    && (binding.kind === 'group' || binding.kind === 'channel' || binding.kind === 'repository')
    && typeof binding.id === 'string'
    && typeof binding.agent === 'string'
}

function validateWorkroom(
  id: string,
  workroom: WorkroomDefinition | undefined,
  agents: Record<string, AgentBinding>,
  endpoints: EndpointInfo[],
): string[] {
  if (!workroom) return []
  const errors: string[] = []
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id)) errors.push('projectId 格式无效')
  if (!workroom.name.trim()) errors.push('名称不能为空')
  if (workroom.enabled !== false && !workroom.members.some((member) => member.role === 'orchestrator')) errors.push('启用时至少需要一个 Orchestrator')
  const memberAgents = new Set(workroom.members.map((member) => member.agent))
  if (workroom.members.some((member) => !agents[member.agent])) errors.push('存在未配置的 Agent')
  if (new Set(workroom.members.map((member) => `${member.agent}:${member.role}`)).size !== workroom.members.length) errors.push('存在重复的 Agent 角色')
  if (workroom.enabled !== false && !workroom.conversation) errors.push('启用时必须绑定群、频道或仓库')
  if (workroom.conversation) {
    const space = workroom.conversation
    if (!space.id.trim()) errors.push('协作空间 ID 不能为空')
    if (space.kind === 'repository' && !/^[^/\s]+\/[^/\s]+$/u.test(space.id.trim())) errors.push('GitHub 仓库必须使用 owner/repo')
    if (!memberAgents.has(space.agent)) errors.push('空间入口 Agent 必须是 Workroom 成员')
    if (!workroom.members.some((member) => member.agent === space.agent && member.role === 'orchestrator')) errors.push('空间入口 Agent 必须承担 Orchestrator 角色')
    if (!endpoints.some((endpoint) => endpoint.adapter === space.adapter && endpoint.name === space.endpoint)) errors.push('关联的 Bot/App Endpoint 不存在')
  }
  return errors
}

function conversationAddress(space: WorkroomConversationBinding): string {
  const id = space.kind === 'repository' ? space.id.toLowerCase() : space.id
  return `${space.adapter}:${space.endpoint}:${space.kind}:${id}`
}

function spaceKindLabel(kind: WorkroomSpaceKind): string {
  return kind === 'repository' ? 'GitHub 仓库' : kind === 'channel' ? '频道' : '群'
}
