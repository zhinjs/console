import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Download, Pause, Play, RefreshCw, RotateCcw, Server, Square, Trash2, Upload } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { EmptyState } from '../../components/empty-state'
import { useToast } from '../../components/toast'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import type {
  GatewayInstanceLogLine, GatewayInstanceStatus, GatewayInstalledPackage, GatewayPackageOperation, GatewayPackagePlan, GatewayPluginConfigurationNeed,
} from '../../contracts/gateway'
import {
  GATEWAY_RPC, failureReasonLabel, formatDuration, instanceActions, instanceStateLabel, instanceStateTone, mergeLogLines,
  operationLabel, parsePackageSpecs, readInstanceStatus, readLogLines, readPackageList, readPackagePlan, transactionSummary, uptimeMs,
} from './gateway-model.mjs'
import { GatewayLoadError, TransactionProgress } from './ops-components'
import { ConfigurationNeedsPanel } from './plugin-declare'
import { gatewayRequest, useGatewayRead, useGatewayTransaction } from './use-gateway'

const STATUS_POLL_MS = 3_000
const LOGS_POLL_MS = 2_000
const LOG_TAIL = 500
const EMPTY_LINES: readonly GatewayInstanceLogLine[] = []
const EMPTY_PACKAGES = { packageManager: '', packages: [] as GatewayInstalledPackage[] }

type LifecycleAction = 'start' | 'stop' | 'restart'

export default function OpsInstancePage() {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canRead = hasConsolePermission('status.view', access)
  const canControl = hasConsolePermission('ops.restart', access)
  const canListPackages = hasConsolePermission('feature.view', access) || hasConsolePermission('plugin.manage', access)
  const canManagePackages = hasConsolePermission('plugin.manage', access)
  const [transactionActive, setTransactionActive] = useState(false)
  const status = useGatewayRead<GatewayInstanceStatus | null>(GATEWAY_RPC.INSTANCE_STATUS, value => readInstanceStatus(value), null, {
    pollMs: STATUS_POLL_MS, enabled: canRead,
  })
  const unsupported = status.errorKind === 'unsupported'

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("实例")}
        description={i18n.t("网关托管的 Zhin 实例：运行状态、启停、实时日志与项目依赖。依赖变更时网关会先停止实例，失败会自动回滚。")}
        actions={canRead ? (
          <Button variant="outline" size="sm" onClick={status.refresh} disabled={status.loading}>
            <RefreshCw className={status.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}
          </Button>
        ) : null}
      />
      {unsupported ? <GatewayLoadError error={status.error ?? ''} kind="unsupported" onRetry={status.refresh} /> : (
        <>
          {canRead ? <InstanceStatusCard status={status} canControl={canControl} locked={transactionActive} /> : null}
          {canRead ? <InstanceLogsCard /> : null}
          {canListPackages ? <DependencyPanel canManage={canManagePackages} onActiveChange={setTransactionActive} onFinished={status.refresh} /> : null}
          {!canRead && !canListPackages ? (
            <p className="text-sm text-muted-foreground" role="note">{i18n.t("当前身份没有查看实例的权限（需要 status.view）。")}</p>
          ) : null}
        </>
      )}
    </PageShell>
  )
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function InstanceStatusCard({ status, canControl, locked }: {
  status: ReturnType<typeof useGatewayRead<GatewayInstanceStatus | null>>
  canControl: boolean
  locked: boolean
}) {
  const i18n = useI18n()
  const toast = useToast()
  const now = useNow(1_000)
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null)
  const data = status.data
  const actions = data ? instanceActions(data.state) : { start: false, stop: false, restart: false }
  const uptime = uptimeMs(data, now)
  const when = (value: number) => i18n.date(value, { dateStyle: 'medium', timeStyle: 'medium' })

  const run = async (action: LifecycleAction) => {
    const type = action === 'start' ? GATEWAY_RPC.INSTANCE_START : action === 'stop' ? GATEWAY_RPC.INSTANCE_STOP : GATEWAY_RPC.INSTANCE_RESTART
    const reply = await gatewayRequest<unknown>(type, {}, i18n.t)
    const next = readInstanceStatus(reply)
    if (next) status.set(next)
    else status.refresh()
    toast.success(action === 'start' ? i18n.t("实例已启动") : action === 'stop' ? i18n.t("实例已停止") : i18n.t("实例已重启"))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4" />{i18n.t("运行状态")}</CardTitle>
          <CardDescription>{i18n.t("崩溃后网关会自动重启；一分钟内重启超过 10 次则停在「已崩溃」，等待人工处理。")}</CardDescription>
        </div>
        {canControl ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!data || !actions.start || locked} onClick={() => setConfirming('start')}><Play />{i18n.t("启动")}</Button>
            <Button size="sm" variant="outline" disabled={!data || !actions.restart || locked} onClick={() => setConfirming('restart')}><RotateCcw />{i18n.t("重启")}</Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={!data || !actions.stop || locked} onClick={() => setConfirming('stop')}><Square />{i18n.t("停止")}</Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {status.error && status.errorKind !== 'unsupported' ? <GatewayLoadError error={status.error} kind={status.errorKind} onRetry={status.refresh} /> : null}
        {locked ? <p className="text-sm text-muted-foreground" role="status">{i18n.t("依赖事务进行中，实例由事务停启。")}</p> : null}
        {!data && !status.loaded ? <Skeleton className="h-20" /> : null}
        {data ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted-foreground">{i18n.t("状态")}</dt><dd className="mt-1"><Badge variant={instanceStateTone(data.state)}>{instanceStateLabel(data.state, i18n.t)}</Badge></dd></div>
            <div><dt className="text-muted-foreground">{i18n.t("进程 PID")}</dt><dd className="mt-1 font-mono">{data.pid ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">{i18n.t("已运行")}</dt><dd className="mt-1">{uptime === null ? '—' : formatDuration(uptime, i18n.t)}</dd></div>
            <div><dt className="text-muted-foreground">{i18n.t("近一分钟重启次数")}</dt><dd className="mt-1">{data.recentRestarts}</dd></div>
            {data.startedAt ? <div><dt className="text-muted-foreground">{i18n.t("启动于")}</dt><dd className="mt-1">{when(data.startedAt)}</dd></div> : null}
            {data.generation !== undefined ? <div><dt className="text-muted-foreground">{i18n.t("运行代次")}</dt><dd className="mt-1 font-mono">{data.generation}</dd></div> : null}
            <div><dt className="text-muted-foreground">{i18n.t("上次退出")}</dt><dd className="mt-1 font-mono">{data.lastExitCode ?? data.lastExitSignal ?? '—'}</dd></div>
          </dl>
        ) : null}
        {data?.lastFailure ? (
          <Alert variant={data.state === 'crashed' ? 'destructive' : 'warning'}>
            <AlertTitle>{i18n.t("最近一次失败：{0}", [failureReasonLabel(data.lastFailure.reason, i18n.t)])}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{data.lastFailure.message}</p>
              <p className="text-xs text-muted-foreground">
                {i18n.t("时间 {0} · 退出码 {1}", [data.lastFailure.at ? when(data.lastFailure.at) : '—', data.lastFailure.exitCode ?? data.lastFailure.signal ?? '—'])}
              </p>
              {data.lastFailure.logTail.length ? (
                <pre aria-label={i18n.t("失败前的日志")} className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">{data.lastFailure.logTail.join('\n')}</pre>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {confirming ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) setConfirming(null) }}
          variant={confirming === 'start' ? 'default' : 'destructive'}
          title={confirming === 'start' ? i18n.t("启动实例？") : confirming === 'stop' ? i18n.t("停止实例？") : i18n.t("重启实例？")}
          description={confirming === 'start'
            ? i18n.t("网关会拉起实例并等待就绪。")
            : confirming === 'stop'
              ? i18n.t("机器人会离线，直到再次启动；Console 的访问控制、终端与本页仍由网关提供。")
              : i18n.t("机器人会短暂离线，正在进行的对话可能中断。")}
          confirmLabel={confirming === 'start' ? i18n.t("启动") : confirming === 'stop' ? i18n.t("停止") : i18n.t("重启")}
          onConfirm={() => run(confirming)} />
      ) : null}
    </Card>
  )
}

function InstanceLogsCard() {
  const i18n = useI18n()
  const [live, setLive] = useState(true)
  const [stream, setStream] = useState<'all' | 'stderr'>('all')
  const [follow, setFollow] = useState(true)
  const read = useCallback((value: unknown, previous: readonly GatewayInstanceLogLine[]) => mergeLogLines(previous, readLogLines(value)), [])
  const logs = useGatewayRead<readonly GatewayInstanceLogLine[]>(GATEWAY_RPC.INSTANCE_LOGS, read, EMPTY_LINES, {
    payload: { lines: LOG_TAIL }, pollMs: live ? LOGS_POLL_MS : undefined,
  })
  const box = useRef<HTMLPreElement>(null)
  const shown = useMemo(() => (stream === 'all' ? logs.data : logs.data.filter(line => line.stream === 'stderr')), [logs.data, stream])
  useEffect(() => {
    const element = box.current
    if (element && follow) element.scrollTop = element.scrollHeight
  }, [shown, follow])
  const onScroll = () => {
    const element = box.current
    if (!element) return
    setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{i18n.t("实例日志")}</CardTitle>
          <CardDescription>{i18n.t("网关采集的实例标准输出与标准错误；实例离线时也能查看。")}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={stream === 'stderr' ? 'secondary' : 'outline'} aria-pressed={stream === 'stderr'} onClick={() => setStream(stream === 'all' ? 'stderr' : 'all')}>
            {i18n.t("只看错误输出")}
          </Button>
          <Button size="sm" variant="outline" aria-pressed={live} onClick={() => setLive(!live)}>
            {live ? <Pause /> : <Play />}{live ? i18n.t("暂停") : i18n.t("实时")}
          </Button>
          {!follow ? (
            <Button size="sm" variant="outline" onClick={() => setFollow(true)}><ArrowDownToLine />{i18n.t("跳到最新")}</Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {logs.error && logs.errorKind !== 'unsupported' ? <GatewayLoadError error={logs.error} kind={logs.errorKind} onRetry={logs.refresh} /> : null}
        {!logs.loaded && logs.loading ? <Skeleton className="h-64" /> : (
          <pre ref={box} onScroll={onScroll} tabIndex={0} aria-label={i18n.t("实例日志")} aria-live="off"
            className="h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {shown.length ? shown.map(line => (
              <div key={line.seq} className={line.stream === 'stderr' ? 'text-destructive' : undefined}>
                <span className="select-none text-muted-foreground">{line.time ? i18n.date(line.time, { timeStyle: 'medium' }) : ''} </span>{line.line}
              </div>
            )) : <span className="text-muted-foreground">{i18n.t("还没有日志。")}</span>}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

interface PendingTransaction {
  operation: GatewayPackageOperation
  packages: readonly string[] | 'all'
  plan: GatewayPackagePlan | null
  enable?: boolean
}

function DependencyPanel({ canManage, onActiveChange, onFinished }: { canManage: boolean; onActiveChange: (active: boolean) => void; onFinished: () => void }) {
  const i18n = useI18n()
  const toast = useToast()
  const list = useGatewayRead(GATEWAY_RPC.PACKAGES_LIST, value => readPackageList(value), EMPTY_PACKAGES)
  const [specText, setSpecText] = useState('')
  const [specTouched, setSpecTouched] = useState(false)
  const [enable, setEnable] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [pending, setPending] = useState<PendingTransaction | null>(null)
  const transaction = useGatewayTransaction()
  const { running, progress, error: runError } = transaction
  const [needs, setNeeds] = useState<readonly GatewayPluginConfigurationNeed[]>([])
  const [declaring, setDeclaring] = useState(false)
  const parsed = parsePackageSpecs(specText, i18n.t)
  const unsupported = list.errorKind === 'unsupported'

  useEffect(() => { onActiveChange(running || declaring) }, [running, declaring, onActiveChange])

  const prepare = async (operation: GatewayPackageOperation, packages: readonly string[] | 'all', extra: { enable?: boolean } = {}) => {
    setPlanning(true)
    try {
      // The plan says what the gateway authorized and whether the instance restarts.
      const plan = readPackagePlan(await gatewayRequest(GATEWAY_RPC.PACKAGES_PLAN, { operation, packages }, i18n.t))
      setPending({ operation, packages, plan, ...extra })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPlanning(false)
    }
  }

  const execute = async (pendingTransaction: PendingTransaction) => {
    const type = transactionType(pendingTransaction.operation)
    const data: Record<string, unknown> = { packages: pendingTransaction.packages }
    if (pendingTransaction.operation === 'install' && pendingTransaction.enable !== undefined) data.enable = pendingTransaction.enable
    if (pendingTransaction.operation === 'install') setNeeds([])
    const { result } = await transaction.run(type, data)
    if (result?.status === 'succeeded') {
      toast.success(transactionSummary(result, i18n.t).title)
      if (pendingTransaction.operation === 'install') setSpecText('')
    }
    // Installed but undeclared plugins wait for their first configuration (ADR 0053 §2 step 4).
    if (result?.needsConfiguration?.length) setNeeds(result.needsConfiguration)
    list.refresh()
    onFinished()
  }

  const submitInstall = () => {
    setSpecTouched(true)
    if (parsed.problem) return
    void prepare('install', parsed.specs, { enable })
  }

  const busy = running || planning || declaring
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{i18n.t("项目依赖")}</CardTitle>
          <CardDescription>
            {list.data.packageManager ? i18n.t("包管理器：{0}。", [list.data.packageManager]) : null}
            {i18n.t("安装、卸载或更新时：备份 → 停止实例 → 执行 → 启动并等待就绪；任何一步失败都会恢复备份并启动旧版本。")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={list.refresh} disabled={list.loading || busy}><RefreshCw className={list.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {canManage && !unsupported ? (
            <Button size="sm" variant="outline" onClick={() => void prepare('update', 'all')} disabled={busy || !list.data.packages.length}><Upload />{i18n.t("全部更新")}</Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.error ? <GatewayLoadError error={list.error} kind={list.errorKind} onRetry={list.refresh} /> : null}
        {!unsupported && canManage ? (
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); submitInstall() }}>
            <label htmlFor="ops-install-specs" className="block text-sm font-medium">{i18n.t("安装依赖")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="ops-install-specs" value={specText} disabled={busy} autoComplete="off" spellCheck={false}
                placeholder="@zhin.js/adapter-qq  sqlite3@^5" aria-invalid={specTouched && parsed.problem ? true : undefined}
                onChange={event => setSpecText(event.target.value)} />
              <Button type="submit" size="sm" disabled={busy}><Download />{i18n.t("安装")}</Button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox id="ops-install-enable" checked={enable} disabled={busy} onCheckedChange={value => setEnable(value === true)} />
              <label htmlFor="ops-install-enable">{i18n.t("安装后在配置中启用插件（普通依赖不受影响）")}</label>
            </div>
            {specTouched && parsed.problem ? <p className="text-xs text-destructive" role="alert">{parsed.problem}</p> : (
              <p className="text-xs text-muted-foreground">{i18n.t("可填多个，用空格或逗号分隔；支持 name@版本范围。非白名单的包只有所有者能安装。")}</p>
            )}
          </form>
        ) : null}
        {!canManage && !unsupported ? <p className="text-sm text-muted-foreground" role="note">{i18n.t("当前身份只能查看依赖；安装、卸载与更新需要 plugin.manage 权限。")}</p> : null}
        {running || progress.id || runError ? <TransactionProgress progress={progress} running={running} error={runError} /> : null}
        {needs.length ? (
          <ConfigurationNeedsPanel needs={needs} disabled={running} onBusyChange={setDeclaring}
            onDeclared={need => { setNeeds(previous => previous.filter(item => item.instanceKey !== need.instanceKey)); list.refresh(); onFinished() }} />
        ) : null}
        {unsupported ? null : list.loading && !list.loaded ? (
          <div className="space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !list.data.packages.length ? (
          <EmptyState compact title={i18n.t("没有依赖")} description={list.loaded ? i18n.t("package.json 里还没有声明依赖。") : undefined} />
        ) : (
          <Table aria-label={i18n.t("项目依赖")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("包")}</TableHead>
                <TableHead>{i18n.t("声明的版本")}</TableHead>
                <TableHead>{i18n.t("已安装")}</TableHead>
                <TableHead>{i18n.t("类型")}</TableHead>
                {canManage ? <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.packages.map(item => (
                <TableRow key={item.name}>
                  <TableCell><span className="font-mono text-sm">{item.name}</span>{item.catalog ? <Badge className="ml-2" size="sm" variant="secondary">{item.catalog}</Badge> : null}</TableCell>
                  <TableCell className="font-mono text-xs">{item.range || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{item.installedVersion ?? <Badge size="sm" variant="warning">{i18n.t("未安装")}</Badge>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.dependencyType}</TableCell>
                  {canManage ? (
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void prepare('update', [item.name])} aria-label={i18n.t("更新 {0}", [item.name])}><Upload />{i18n.t("更新")}</Button>
                      <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void prepare('uninstall', [item.name])} aria-label={i18n.t("卸载 {0}", [item.name])}><Trash2 />{i18n.t("卸载")}</Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {pending ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) setPending(null) }}
          variant={pending.operation === 'uninstall' ? 'destructive' : 'default'}
          title={pending.packages === 'all' ? i18n.t("更新全部依赖？") : i18n.t("{0} {1}？", [operationLabel(pending.operation, i18n.t), pending.packages.join(', ')])}
          description={pending.plan?.restartsInstance
            ? i18n.t("执行期间实例会停止，完成后自动启动；失败会回滚到当前依赖。")
            : i18n.t("实例当前未运行，执行后保持原状态；失败会回滚到当前依赖。")}
          confirmLabel={operationLabel(pending.operation, i18n.t)}
          onConfirm={() => { const transaction = pending; setPending(null); void execute(transaction) }}>
          {pending.plan?.packages.length ? (
            <ul className="space-y-1 text-sm" aria-label={i18n.t("将要处理的包")}>
              {pending.plan.packages.map(item => (
                <li key={item.name} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
                  <span className="font-mono">{item.spec}</span><Badge size="sm" variant="secondary">{item.source}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </Card>
  )
}

/** The RPC of a package operation; every operation has one. */
function transactionType(operation: GatewayPackageOperation): string {
  switch (operation) {
    case 'install': return GATEWAY_RPC.PACKAGES_INSTALL
    case 'uninstall': return GATEWAY_RPC.PACKAGES_UNINSTALL
    case 'update': return GATEWAY_RPC.PACKAGES_UPDATE
    default: return assertNever(operation)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected gateway operation ${String(value)}`)
}
