import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Clipboard,
  FileKey2,
  Loader2,
  RefreshCw,
  Rocket,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { CONSOLE_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ErrorAlert } from '../components/error-alert'
import { Skeleton } from '../components/ui/skeleton'

interface PlanningSetupStatus {
  projectId: string
  ready: boolean
  principalId?: string
  trustedPackPublisher: boolean
  projectSponsor: boolean
  catalogReady: boolean
  registryRevision: number
  activeProfile?: { revisionId: string; digest: string }
  planningPolicyReady: boolean
  disclosureReady: boolean
  disclosureConfigReady: boolean
  modelProviderAlias?: string
  availableAgents: string[]
  availableTools: string[]
  availableSkills: string[]
  diagnostics: string[]
}

export function PlanningDisclosurePanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<PlanningSetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const next = await requestConsole<PlanningSetupStatus>({
        type: CONSOLE_RPC.WORKROOM_PROFILE_STATUS,
        projectId,
      })
      if (version === requestVersion.current) setStatus(next)
    } catch (caught) {
      if (version === requestVersion.current) {
        setStatus(null)
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setStatus(null)
    setBootstrapping(false)
    void load()
    return () => {
      requestVersion.current += 1
    }
  }, [load])

  const bootstrap = async () => {
    if (!status || bootstrapping) return
    const targetProjectId = status.projectId
    setBootstrapping(true)
    setError(null)
    try {
      const next = await requestConsole<PlanningSetupStatus>({
        type: CONSOLE_RPC.WORKROOM_PROFILE_BOOTSTRAP,
        operationId: `console:planning-bootstrap:${targetProjectId}:${Date.now()}`,
        projectId: targetProjectId,
        expectedRegistryRevision: status.registryRevision,
        includeTools: status.availableTools,
        includeSkills: status.availableSkills,
      })
      if (targetProjectId === projectId) setStatus(next)
    } catch (caught) {
      if (targetProjectId === projectId) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (targetProjectId === projectId) setBootstrapping(false)
    }
  }

  return (
    <section className="console-dashboard-panel overflow-hidden" aria-labelledby="planning-disclosure-title">
      <div className="console-panel-heading border-b px-4 py-4 sm:px-5">
        <div>
          <span className="console-eyebrow">Governed setup</span>
          <h2 id="planning-disclosure-title">规划与披露配置</h2>
          <p>诊断 Catalog、Sponsor、Profile、Planning Policy 与 P12 模型披露 authority，并以当前 generation 的真实能力初始化。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status ? <Badge variant={status.ready ? 'success' : 'warning'}>{status.ready ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <ShieldAlert className="mr-1 h-3 w-3" />}{status.ready ? '可以提交 /work' : '需要配置'}</Badge> : null}
          <Button asChild variant="outline" size="sm"><Link to="/config"><Settings2 />配置</Link></Button>
          <Button variant="outline" size="sm" disabled={loading || bootstrapping} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />重新检查</Button>
        </div>
      </div>

      {loading && !status ? <PlanningSkeleton /> : null}
      {error ? <div className="p-4 sm:p-5"><ErrorAlert error={error} onRetry={() => load()} /></div> : null}
      {status ? <PlanningStatus status={status} busy={bootstrapping} onBootstrap={() => void bootstrap()} /> : null}
    </section>
  )
}

function PlanningStatus(props: {
  status: PlanningSetupStatus
  busy: boolean
  onBootstrap(): void
}) {
  const { status } = props
  const bootstrapAllowed = !status.ready
    && status.catalogReady
    && status.trustedPackPublisher
    && status.projectSponsor
  const actionLabel = status.planningPolicyReady
    ? '初始化披露能力'
    : status.activeProfile
      ? '补齐编排能力'
      : '初始化编排能力'

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="规划与披露能力门禁">
        <CapabilityStage label="Catalog" ready={status.catalogReady} detail="Workroom 已登记" />
        <CapabilityStage label="Sponsor" ready={status.projectSponsor} detail={status.principalId ?? '未绑定 principal'} />
        <CapabilityStage label="Profile" ready={Boolean(status.activeProfile)} detail={status.activeProfile?.revisionId ?? '尚未激活'} />
        <CapabilityStage label="Planning" ready={status.planningPolicyReady} detail="Planning Policy" />
        <CapabilityStage label="Disclosure" ready={status.disclosureReady} detail={status.disclosureConfigReady ? 'P12 authority' : '处理方契约待配置'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-3">
          <div className={cn(
            'rounded-xl border p-4',
            status.ready
              ? 'border-emerald-500/25 bg-emerald-500/[0.055]'
              : 'border-amber-500/25 bg-amber-500/[0.055]',
          )}>
            <div className="flex items-start gap-3">
              <span className={cn('rounded-lg border p-2', status.ready ? 'border-emerald-500/25 text-emerald-600' : 'border-amber-500/25 text-amber-600')}>
                {status.ready ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{status.ready ? 'Workroom 编排已就绪' : 'Workroom 编排尚未就绪'}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Project <code>{status.projectId}</code> · Registry rev {status.registryRevision} · {status.availableAgents.length} Agents / {status.availableTools.length} Tools / {status.availableSkills.length} Skills</p>
              </div>
            </div>
          </div>

          {status.diagnostics.length ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold"><ShieldAlert className="h-4 w-4 text-amber-600" />需要处理</h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                {status.diagnostics.map((diagnostic) => <li key={diagnostic} className="flex gap-2"><span aria-hidden="true">•</span><span>{diagnostic}</span></li>)}
              </ul>
            </div>
          ) : null}

          {bootstrapAllowed ? (
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/[0.14] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />{actionLabel}</h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{bootstrapDescription(status)}</p>
              </div>
              <Button className="shrink-0" disabled={props.busy} onClick={props.onBootstrap}>
                {props.busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                {props.busy ? '初始化中' : actionLabel}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          {!status.principalId || !status.trustedPackPublisher ? <SponsorConfigSnippet /> : null}
          {!status.disclosureReady && status.modelProviderAlias && !status.disclosureConfigReady
            ? <DisclosureConfigSnippet providerAlias={status.modelProviderAlias} />
            : null}
          {status.ready ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-xs leading-relaxed text-muted-foreground">
              <h3 className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" />Authority 已发布</h3>
              <p className="mt-2">规划入口会固定使用当前 Profile、Planning Policy 与加密披露 authority；后续能力变化不会静默扩大既有 Run 权限。</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CapabilityStage(props: { label: string; ready: boolean; detail: string }) {
  return (
    <article className={cn('rounded-lg border px-3 py-2.5', props.ready ? 'border-emerald-500/20 bg-emerald-500/[0.035]' : 'bg-muted/[0.12]')}>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{props.label}</strong>
        {props.ready ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-2 w-2 rounded-full bg-amber-500" />}
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground" title={props.detail}>{props.detail}</p>
    </article>
  )
}

function SponsorConfigSnippet() {
  return <ConfigSnippet
    icon={FileKey2}
    title="首次配置所需 YAML"
    description="保存后重启 Host，再用 Sponsor Token 登录并把 principal 加入 Project sponsors。"
    code={'http:\n  tokens:\n    - token: ${WORKROOM_SPONSOR_TOKEN}\n      scope: full\n      principalId: workroom-admin\nai:\n  workroom:\n    trustedPackPublishers:\n      - workroom-admin'}
  />
}

function DisclosureConfigSnippet({ providerAlias }: { providerAlias: string }) {
  return <ConfigSnippet
    icon={ShieldCheck}
    title="模型处理方披露契约"
    description="占位符必须按 Provider 合同和账号策略填写；外部 Provider 只有在禁止训练后才能初始化。OpenRouter 还需在 Privacy/Guardrail 中启用 ZDR 并关闭 data collection；YAML 不会替你修改第三方账号策略。"
    code={`ai:\n  workroom:\n    disclosure:\n      modelProviders:\n        ${providerAlias}:\n          endpoint: REPLACE_WITH_CONTRACTED_ENDPOINT\n          processingRegions: [REPLACE_WITH_CONTRACTED_REGION]\n          maxConfidentiality: project_internal\n          external: true\n          noTraining: REPLACE_WITH_PROVIDER_GUARANTEE\n          loggingMode: REPLACE_WITH_LOGGING_MODE\n          maximumRetentionSeconds: REPLACE_WITH_MAX_RETENTION_SECONDS\n          allowsRedisclosure: REPLACE_WITH_PROVIDER_GUARANTEE\n          supportsDeletion: REPLACE_WITH_PROVIDER_GUARANTEE`}
  />
}

function ConfigSnippet(props: {
  icon: typeof FileKey2
  title: string
  description: string
  code: string
}) {
  const [copied, setCopied] = useState(false)
  const Icon = props.icon
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <details className="overflow-hidden rounded-xl border bg-muted/[0.1]" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">{props.title}</span>
      </summary>
      <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{props.description}</p>
      <div className="relative border-t bg-background/70">
        <button type="button" className="absolute right-2 top-2 rounded-md border bg-background px-2 py-1 text-[10px] hover:bg-muted" onClick={() => void copy()}><Clipboard className="mr-1 inline h-3 w-3" />{copied ? '已复制' : '复制'}</button>
        <pre className="max-h-64 overflow-auto p-3 pr-20 text-[10px] leading-relaxed"><code>{props.code}</code></pre>
      </div>
    </details>
  )
}

function bootstrapDescription(status: PlanningSetupStatus): string {
  if (!status.activeProfile) {
    return `固定当前 ${status.availableAgents.length} 个 Agent、${status.availableTools.length} 个 Tool、${status.availableSkills.length} 个 Skill 到首个 Profile，并发布 Planning Policy 与 P12 披露 authority。`
  }
  if (!status.planningPolicyReady) return '为当前 active Profile 发布默认 Planning Policy 与 P12 模型披露 authority。'
  return '为当前 Project 发布加密的 P12 模型披露 authority。'
}

function PlanningSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 rounded-lg" />)}</div>
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
    </div>
  )
}
