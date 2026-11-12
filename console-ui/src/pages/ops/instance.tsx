import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Download, Pause, Play, RefreshCw, RotateCcw, Square, Trash2, Upload } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { useToast } from '../../components/toast'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import type {
  GatewayInstanceLogLine, GatewayInstanceStatus, GatewayInstalledPackage, GatewayPackageOperation, GatewayPackagePlan, GatewayPluginConfigurationNeed,
} from '../../contracts/gateway'
import {
  GATEWAY_RPC, failureReasonLabel, formatDuration, instanceActions, instanceLifecycleApplied, instanceStateLabel, instanceStateTone, mergeLogLines,
  operationLabel, parsePackageSpecs, readInstanceStatus, readLogLines, readPackageList, readPackagePlan, transactionSummary, uptimeMs,
} from './gateway-model.mjs'
import { GatewayLoadError, TransactionProgress } from './ops-components'
import { ConfigurationNeedsPanel } from './plugin-declare'
import { gatewayRequest, useGatewayRead, useGatewayTransaction } from './use-gateway'
import '../admin-pages.css'

import { INSTANCE_SECTION_IDS } from './instance-sections.mjs'

export { INSTANCE_SECTION_IDS }

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

  useScrollToHash(status.loaded)

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("实例")}
        description={i18n.t("运行状态的唯一详情页：网关托管的 Zhin 实例的状态、启停、实时日志与项目依赖。实例离线时本页仍由网关提供。")}
        actions={canRead ? (
          <Button variant="outline" size="sm" onClick={status.refresh} disabled={status.loading}>
            <RefreshCw className={status.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}
          </Button>
        ) : null}
      />
      {unsupported ? <GatewayLoadError error={status.error ?? ''} kind="unsupported" onRetry={status.refresh} /> : (
        <>
          {canRead ? <InstanceStatusSection status={status} canControl={canControl} locked={transactionActive} /> : null}
          {canRead ? <InstanceLogsSection /> : null}
          {canListPackages ? <DependencyPanel canManage={canManagePackages} onActiveChange={setTransactionActive} onFinished={status.refresh} /> : null}
          {!canRead && !canListPackages ? <StatusState kind="forbidden" permissions={['status.view']} /> : null}
        </>
      )}
    </PageShell>
  )
}

/** Scrolls to `#instance-…` once the content exists (links from the bot status page). */
function useScrollToHash(ready: boolean) {
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current || typeof window === 'undefined') return
    const id = window.location.hash.slice(1)
    if (!id) return
    done.current = true
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [ready])
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

const LIFECYCLE_TYPES: Record<LifecycleAction, string> = {
  start: GATEWAY_RPC.INSTANCE_START,
  stop: GATEWAY_RPC.INSTANCE_STOP,
  restart: GATEWAY_RPC.INSTANCE_RESTART,
}

interface LifecyclePlan { readonly action: LifecycleAction; readonly before: GatewayInstanceStatus | null | undefined }

function InstanceStatusSection({ status, canControl, locked }: {
  status: ReturnType<typeof useGatewayRead<GatewayInstanceStatus | null>>
  canControl: boolean
  locked: boolean
}) {
  const i18n = useI18n()
  const now = useNow(1_000)
  const data = status.data
  const actions = data ? instanceActions(data.state) : { start: false, stop: false, restart: false }
  const uptime = uptimeMs(data, now)
  const when = (value: number) => i18n.date(value, { dateStyle: 'medium', timeStyle: 'medium' })
  // 准备 → 确认（停止 / 重启再确认一次）→ 提交；结果未知时只读核对状态，不重放。The plan carries the
  // action and the status it was prepared from: a restart is only 已生效 when the run changed.
  const receipt = useActionReceipt({
    submit: async plan => {
      const { action } = plan.payload as LifecyclePlan
      const next = readInstanceStatus(await gatewayRequest<unknown>(LIFECYCLE_TYPES[action], {}, i18n.t))
      if (next) status.set(next)
      else status.refresh()
    },
    verify: async plan => {
      const { action, before } = plan.payload as LifecyclePlan
      const next = readInstanceStatus(await gatewayRequest<unknown>(GATEWAY_RPC.INSTANCE_STATUS, {}, i18n.t))
      if (!next) return undefined
      status.set(next)
      return { applied: instanceLifecycleApplied(action, before, next) }
    },
  })
  const prepare = (next: LifecycleAction) => {
    const payload: LifecyclePlan = { action: next, before: data }
    if (next === 'start') {
      receipt.prepare({ title: i18n.t('启动实例'), changes: [i18n.t('网关拉起实例并等待就绪')], confirmLabel: i18n.t('启动'), payload })
    } else if (next === 'stop') {
      receipt.prepare({
        title: i18n.t('停止实例'),
        changes: [i18n.t('机器人离线，直到再次启动'), i18n.t('访问控制、终端、实例日志和本页仍由网关提供')],
        danger: true, confirmLabel: i18n.t('停止'), payload,
      })
    } else {
      receipt.prepare({
        title: i18n.t('重启实例'),
        changes: [i18n.t('机器人短暂离线，正在进行的对话可能中断'), i18n.t('网关等待新实例就绪')],
        danger: true, confirmLabel: i18n.t('重启'), payload,
      })
    }
  }
  const pending = receiptBlocksActions(receipt.state)

  return (
    <div id={INSTANCE_SECTION_IDS.status} className="scroll-mt-4">
      <ObjectSection title={i18n.t("运行状态")}
        description={i18n.t("崩溃后网关会自动重启；一分钟内重启超过 10 次则停在「已崩溃」，等待人工处理。")}
        actions={canControl ? <>
          <Button size="sm" variant="outline" disabled={!data || !actions.start || locked || pending} onClick={() => prepare('start')}><Play />{i18n.t("启动")}</Button>
          <Button size="sm" variant="outline" disabled={!data || !actions.restart || locked || pending} onClick={() => prepare('restart')}><RotateCcw />{i18n.t("重启")}</Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={!data || !actions.stop || locked || pending} onClick={() => prepare('stop')}><Square />{i18n.t("停止")}</Button>
        </> : null}>
        <ActionReceipt controller={receipt} />
        <Card className="console-admin-card">
          {status.error && status.errorKind !== 'unsupported' ? <GatewayLoadError error={status.error} kind={status.errorKind} failure={status.failure} onRetry={status.refresh} permissions={['status.view']} /> : null}
          {locked ? <p className="console-admin-note" role="status">{i18n.t("依赖事务进行中，实例由事务停启。")}</p> : null}
          {!data && !status.loaded ? <Skeleton className="h-20" /> : null}
          {data ? (
            <dl className="console-object-facts">
              <div><dt>{i18n.t("状态")}</dt><dd><Badge variant={instanceStateTone(data.state)}>{instanceStateLabel(data.state, i18n.t)}</Badge></dd></div>
              <div><dt>{i18n.t("进程 PID")}</dt><dd className="font-mono">{data.pid ?? '—'}</dd></div>
              <div><dt>{i18n.t("已运行")}</dt><dd>{uptime === null ? '—' : formatDuration(uptime, i18n.t)}</dd></div>
              <div><dt>{i18n.t("近一分钟重启次数")}</dt><dd>{data.recentRestarts}</dd></div>
              {data.startedAt ? <div><dt>{i18n.t("启动于")}</dt><dd>{when(data.startedAt)}</dd></div> : null}
              {data.generation !== undefined ? <div><dt>{i18n.t("运行代次")}</dt><dd className="font-mono">{data.generation}</dd></div> : null}
              <div><dt>{i18n.t("上次退出")}</dt><dd className="font-mono">{data.lastExitCode ?? data.lastExitSignal ?? '—'}</dd></div>
              <div><dt>{i18n.t("实例 ID")}</dt><dd><code className="console-access-id" title={data.instanceId}>{data.instanceId}</code></dd></div>
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
                  <pre aria-label={i18n.t("失败前的日志")} className="console-admin-tail">{data.lastFailure.logTail.join('\n')}</pre>
                ) : null}
                {data.state === 'crashed' ? (
                  <p className="text-xs">{i18n.t("下一步：查看下方实例日志找到原因（常见：依赖未安装、配置缺少必填项、环境变量为空），修复后点「启动」。依赖问题可在「项目依赖」里重新安装。")}</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </Card>
      </ObjectSection>
    </div>
  )
}

function InstanceLogsSection() {
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
    <div id={INSTANCE_SECTION_IDS.logs} className="scroll-mt-4">
      <ObjectSection title={i18n.t("实例日志")} description={i18n.t("网关采集的实例标准输出与标准错误；实例离线时也能查看。")}
        actions={<>
          <Button size="sm" variant={stream === 'stderr' ? 'secondary' : 'outline'} aria-pressed={stream === 'stderr'} onClick={() => setStream(stream === 'all' ? 'stderr' : 'all')}>
            {i18n.t("只看错误输出")}
          </Button>
          <Button size="sm" variant="outline" aria-pressed={live} onClick={() => setLive(!live)}>
            {live ? <Pause /> : <Play />}{live ? i18n.t("暂停") : i18n.t("实时")}
          </Button>
          {!follow ? (
            <Button size="sm" variant="outline" onClick={() => setFollow(true)}><ArrowDownToLine />{i18n.t("跳到最新")}</Button>
          ) : null}
        </>}>
        {logs.error && logs.errorKind !== 'unsupported' ? <GatewayLoadError error={logs.error} kind={logs.errorKind} failure={logs.failure} onRetry={logs.refresh} permissions={['status.view']} /> : null}
        {!logs.loaded && logs.loading ? <Skeleton className="h-64" /> : (
          <pre ref={box} onScroll={onScroll} tabIndex={0} aria-label={i18n.t("实例日志")} aria-live="off" className="console-admin-log">
            {shown.length ? shown.map(line => (
              <div key={line.seq} className={line.stream === 'stderr' ? 'is-stderr' : undefined}>
                <span className="console-admin-log-time">{line.time ? i18n.date(line.time, { timeStyle: 'medium' }) : ''} </span>{line.line}
              </div>
            )) : <span className="text-muted-foreground">{i18n.t("还没有日志。实例启动后，标准输出与标准错误会出现在这里。")}</span>}
          </pre>
        )}
      </ObjectSection>
    </div>
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
  const [planError, setPlanError] = useState<unknown>(null)
  const pending = useRef<PendingTransaction | null>(null)
  const transaction = useGatewayTransaction()
  const { running, progress, error: runError } = transaction
  const [needs, setNeeds] = useState<readonly GatewayPluginConfigurationNeed[]>([])
  const [declaring, setDeclaring] = useState(false)
  const parsed = parsePackageSpecs(specText, i18n.t)
  const unsupported = list.errorKind === 'unsupported'

  useEffect(() => { onActiveChange(running || declaring) }, [running, declaring, onActiveChange])

  // 准备（网关的计划）→ 确认（卸载再确认一次）→ 事务；回滚算「未执行」，断连算「结果未知」只读核对。
  const receipt = useActionReceipt({
    submit: async () => {
      const current = pending.current
      if (!current) throw new Error('no transaction')
      const data: Record<string, unknown> = { packages: current.packages }
      if (current.operation === 'install' && current.enable !== undefined) data.enable = current.enable
      if (current.operation === 'install') setNeeds([])
      const { result, error } = await transaction.run(transactionType(current.operation), data)
      list.refresh()
      onFinished()
      if (error) throw error
      if (!result) return { status: 'unknown', message: i18n.t('网关没有返回事务结果。') }
      // Installed but undeclared plugins wait for their first configuration (ADR 0053 §2 step 4).
      if (result.needsConfiguration?.length) setNeeds(result.needsConfiguration)
      const summary = transactionSummary(result, i18n.t)
      if (result.status === 'succeeded') {
        if (current.operation === 'install') setSpecText('')
        return { status: 'succeeded', message: result.needsConfiguration?.length ? i18n.t('已安装，还需要在下方填写首次配置。') : summary.title }
      }
      return { status: 'failed', message: [summary.title, result.error].filter(Boolean).join('：') }
    },
    verify: async () => {
      const current = pending.current
      const reply = readPackageList(await gatewayRequest(GATEWAY_RPC.PACKAGES_LIST, {}, i18n.t))
      list.set(reply)
      if (!current || current.packages === 'all' || current.operation === 'update') return undefined
      const names = current.packages.map(spec => spec.replace(/(.)@.*$/u, '$1'))
      const present = names.every(name => reply.packages.some(item => item.name === name && item.installedVersion))
      const absent = names.every(name => !reply.packages.some(item => item.name === name))
      return { applied: current.operation === 'install' ? present : absent }
    },
  })

  const prepare = async (operation: GatewayPackageOperation, packages: readonly string[] | 'all', extra: { enable?: boolean } = {}) => {
    setPlanning(true)
    setPlanError(null)
    try {
      // The plan says what the gateway authorized and whether the instance restarts.
      const plan = readPackagePlan(await gatewayRequest(GATEWAY_RPC.PACKAGES_PLAN, { operation, packages }, i18n.t))
      pending.current = { operation, packages, plan, ...extra }
      const names = plan?.packages.length ? plan.packages.map(item => `${item.spec} · ${item.source}`) : packages === 'all' ? [i18n.t('全部依赖')] : [...packages]
      receipt.prepare({
        title: packages === 'all' ? i18n.t("更新全部依赖") : i18n.t("{0} {1}", [operationLabel(operation, i18n.t), packages.join(', ')]),
        summary: plan?.restartsInstance
          ? i18n.t("执行期间实例会停止，完成后自动启动；失败会回滚到当前依赖。")
          : i18n.t("实例当前未运行，执行后保持原状态；失败会回滚到当前依赖。"),
        changes: names,
        danger: operation === 'uninstall',
        confirmLabel: operationLabel(operation, i18n.t),
      })
    } catch (error) {
      setPlanError(error)
    } finally {
      setPlanning(false)
    }
  }

  const submitInstall = () => {
    setSpecTouched(true)
    if (parsed.problem) return
    void prepare('install', parsed.specs, { enable })
  }

  const busy = running || planning || declaring || receiptBlocksActions(receipt.state)
  return (
    <div id={INSTANCE_SECTION_IDS.dependencies} className="scroll-mt-4">
      <ObjectSection title={i18n.t("项目依赖")}
        description={`${list.data.packageManager ? i18n.t("包管理器：{0}。", [list.data.packageManager]) : ''}${i18n.t("安装、卸载或更新时：备份 → 停止实例 → 执行 → 启动并等待就绪；任何一步失败都会恢复备份并启动旧版本。")}`}
        actions={<>
          <Button size="sm" variant="outline" onClick={list.refresh} disabled={list.loading || busy}><RefreshCw className={list.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {canManage && !unsupported ? (
            <Button size="sm" variant="outline" onClick={() => void prepare('update', 'all')} disabled={busy || !list.data.packages.length}><Upload />{i18n.t("全部更新")}</Button>
          ) : null}
        </>}>
        {list.error ? <GatewayLoadError error={list.error} kind={list.errorKind} failure={list.failure} onRetry={list.refresh} permissions={['feature.view']} /> : null}
        {planError ? <StatusState compact error={planError} permissions={['plugin.manage']} onRetry={() => setPlanError(null)} /> : null}
        <ActionReceipt controller={receipt} />
        {running || progress.id || runError ? <TransactionProgress progress={progress} running={running} error={runError} /> : null}
        {needs.length ? (
          <ConfigurationNeedsPanel needs={needs} disabled={running} onBusyChange={setDeclaring}
            onDeclared={need => { setNeeds(previous => previous.filter(item => item.instanceKey !== need.instanceKey)); list.refresh(); onFinished(); toast.success(i18n.t('已声明 {0}', [need.instanceKey])) }} />
        ) : null}
        <Card className="console-admin-card">
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
          {!canManage && !unsupported ? <p className="console-admin-note" role="note">{i18n.t("当前身份只能查看依赖；安装、卸载与更新需要 plugin.manage 权限。")}</p> : null}
        </Card>
        {unsupported ? null : list.loading && !list.loaded ? (
          <div className="space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : list.error && !list.loaded ? null : !list.data.packages.length ? (
          <StatusState kind="empty" title={i18n.t("没有依赖")} description={i18n.t("package.json 里还没有声明依赖。用上面的「安装依赖」添加。")} />
        ) : (
          <Card className="overflow-hidden p-0">
            <Table aria-label={i18n.t("项目依赖")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t("包")}</TableHead>
                  <TableHead className="hidden md:table-cell">{i18n.t("声明的版本")}</TableHead>
                  <TableHead>{i18n.t("已安装")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{i18n.t("类型")}</TableHead>
                  {canManage ? <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.packages.map(item => (
                  <TableRow key={item.name}>
                    <TableCell className="min-w-0"><code className="break-all font-mono text-sm">{item.name}</code>{item.catalog ? <Badge className="ml-2" size="sm" variant="secondary">{item.catalog}</Badge> : null}</TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{item.range || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{item.installedVersion ?? <Badge size="sm" variant="warning">{i18n.t("未安装")}</Badge>}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{item.dependencyType}</TableCell>
                    {canManage ? (
                      <TableCell className="whitespace-nowrap text-right">
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void prepare('update', [item.name])} aria-label={i18n.t("更新 {0}", [item.name])}><Upload /><span className="hidden sm:inline">{i18n.t("更新")}</span></Button>
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void prepare('uninstall', [item.name])} aria-label={i18n.t("卸载 {0}", [item.name])}><Trash2 /><span className="hidden sm:inline">{i18n.t("卸载")}</span></Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </ObjectSection>
    </div>
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
