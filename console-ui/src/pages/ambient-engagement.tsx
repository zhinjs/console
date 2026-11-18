import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { parse as parseConfigSource } from 'yaml'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { ApplyFeedback, type ApplyOutcome, type ReadBackMismatch } from '../components/ApplyFeedback'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ConnectionRequiredState } from '../components/connection-required'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { normalizeGroupRecord } from './endpoint-detail/conversation-labels'
import { pluginRpc } from '../utils/plugin-rpc'
import { useConsoleRead } from '../hooks/use-console-read'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader, PageShell, RadioGroup, RadioGroupItem, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { AmbientGroupPicker } from './AmbientGroupPicker'
import { StatusState } from '../components/StatusState'
import { ScopeFilterBar, useScopeFilter } from './insights/ScopeFilterBar'
import { ambientGroupKey } from './insights/scope-filter.mjs'
import { ConfigurationLiveStatus } from '../components/PluginConfigForm/ConfigurationLiveStatus'
import { configurationReceiptForRead, type ConfigurationApplicationStatus } from '../components/PluginConfigForm/config-live-status.mjs'
import { apiFetch } from '../utils/auth'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import { InferenceRequestError, inferenceError, inferenceRequest, type AmbientJudgePolicy } from './inference/model.mjs'
import { ambientAgreement, ambientJudgeChainRows, isMissingRoute, planWarningText, readAmbientJudgeMode, readAmbientJudgeView, writeAmbientJudgeMode } from './inference/ambient-judge-model.mjs'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import {
  BEHAVIOR_CHOICES,
  ambientJudgeState,
  ambientModePlan,
  hasMergedJudge,
  ambientGroupLabel,
  buildAmbientPatches,
  describeAmbientStatus,
  describeReadFailure,
  describeSaveResult,
  ambientSaveOutcome,
  ambientRestartOutcome,
  isPermissionDenied,
  AMBIENT_STATUS_PERMISSION,
  readAmbientSettings,
  summarizeRecentByGroup,
  validateAmbientSettings,
  validateAmbientStatus,
  type AmbientBehavior,
  type AmbientJudgeState,
  type AmbientSettings,
  type AmbientStatus,
  type AmbientStatusView,
} from './ambient-engagement-model.mjs'

type ConfigSource = ConfigurationApplicationStatus & { source: string; revision: string }
type StatusRead = { denied: true } | { denied: false; view: AmbientStatusView; status: AmbientStatus }
/**
 * The interjection judge as the settings form needs it (ADR 0066): `merged` (with the policy when the
 * caller may read it), `legacy` (an older instance: the form writes `ai.trigger.ambient.mode` as
 * before) or `unknown` (nothing about the mode is shown as known or written).
 */
type JudgeSettings = AmbientJudgeState & { policy?: AmbientJudgePolicy }
type SettingsRead = { settings: AmbientSettings; revision: string; application?: ConfigurationApplicationStatus; readEpoch?: number; judge?: JudgeSettings }
type PatchResult = ConfigurationApplicationStatus & {
  status?: string
  revision?: string
  errors?: Array<{ path: string; message: string }>
}

async function readAmbientStatus(locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<StatusRead> {
  try {
    const data = await pluginRpc<unknown>('root', 'ambient')
    const status = validateAmbientStatus(data, locale)
    return { denied: false, view: describeAmbientStatus(status, locale), status }
  } catch (error) {
    if (isPermissionDenied(error)) return { denied: true }
    throw error
  }
}

/**
 * Which mode the interjection judge runs in and whether this caller can change it, decided only on
 * evidence (`ambientJudgeState`): a failed read is never taken for an older instance. Never throws.
 */
async function readJudgeSettings(): Promise<JudgeSettings> {
  const [judgeRead, status] = await Promise.all([
    inferenceRequest<unknown>(apiFetch, { path: '/ambient-judge' }).then(data => ({ judge: readAmbientJudgeView(data), error: null as unknown }), (error: unknown) => ({ judge: null, error })),
    pluginRpc<unknown>('root', 'ambient').then(data => validateAmbientStatus(data)).catch(() => null),
  ])
  return ambientJudgeState({ judge: judgeRead.judge, judgeMissing: isMissingRoute(judgeRead.error), status })
}

async function readAmbientSettingsFromHost(): Promise<SettingsRead> {
  const [configSource, judge] = await Promise.all([requestConsole<ConfigSource>({ type: 'config:get-source' }), readJudgeSettings()])
  const configDocument: unknown = parseConfigSource(configSource.source)
  const settings = readAmbientSettings(configDocument, judge.state === 'merged' ? { judgeMode: judge.mode } : {})
  return { settings, revision: configSource.revision, application: { application: configSource.application, applicationError: configSource.applicationError }, judge }
}

function formatTime(timestamp: number, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return new Date(timestamp).toLocaleString(locale)
}

export default function AmbientEngagementPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <ConnectionRequiredState title={i18n.t("群聊插话")} />
  return <AmbientEngagementSession key={scope} />
}

function AmbientEngagementSession() {
  const i18n = useI18n()
  // Labels are rendered into the view at read time: read in the current interface language.
  const statusRead = useConsoleRead<StatusRead | null>(() => readAmbientStatus(i18n.locale), null)
  const configurationReadEpoch = useRef(0)
  const settingsRead = useConsoleRead<SettingsRead | null>(async () => {
    const readEpoch = ++configurationReadEpoch.current
    return { ...await readAmbientSettingsFromHost(), readEpoch }
  }, null)
  const refreshAll = () => {
    void statusRead.refresh().catch(() => {})
    void settingsRead.refresh().catch(() => {})
  }
  const loading = statusRead.loading || settingsRead.loading
  // 从会话对象页进入时带 adapter / endpoint / conversation：设置区预选这个群。
  const scopeFilter = useScopeFilter()
  const focusGroup = ambientGroupKey(scopeFilter.scope)
  return <PageShell>
    <PageHeader
      title={i18n.t("群聊插话")}
      description={i18n.t("没人 @ 机器人的时候，它要不要自己在群里接话。")}
      actions={<Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />
    <ScopeFilterBar
      filter={scopeFilter}
      note={focusGroup
        ? i18n.t("下方设置会预选群 {0}；状态与最近记录仍显示全部群。", [focusGroup])
        : i18n.t("群聊插话只按群设置，这个范围不是群聊，设置不会预选。")}
    />
    <AmbientStatusSection read={statusRead} onRetry={() => { void statusRead.refresh().catch(() => {}) }} />
    <AmbientSettingsSection
      focusGroup={focusGroup}
      read={settingsRead}
      onReload={() => settingsRead.refresh()}
      currentReadEpoch={() => configurationReadEpoch.current}
    />
  </PageShell>
}

type StatusReadState = ReturnType<typeof useConsoleRead<StatusRead | null>>

function AmbientStatusSection({ read, onRetry }: { read: StatusReadState; onRetry: () => void }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <StatusState kind="loading" onRetry={onRetry} placeholder={<Skeleton className="h-40 w-full" />} />
  const failure = read.error ? describeReadFailure(read.error, i18n.t("群聊插话状态"), i18n.locale) : null
  if (failure && !read.loaded && !failure.denied) return <StatusState error={read.error} description={failure.text} onRetry={onRetry} />
  if (!read.data && !failure?.denied) return null
  if (!read.data || read.data.denied) {
    return <StatusState kind="forbidden" permissions={[AMBIENT_STATUS_PERMISSION]} />
  }
  const view = read.data.view
  return <Card>
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
        {i18n.t("现在：")}<Badge variant={view.behavior === i18n.t('主动参与') ? 'outline' : 'secondary'}>{view.behavior}</Badge>
        <span className="text-sm font-normal text-muted-foreground">{i18n.t("范围：")}{view.groupScope}</span>
      </CardTitle>
      <CardDescription>{i18n.t("缓冲内观察：最近 24 小时、实例这次启动以来的记录，重启后重新计数。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {failure && <p className="text-xs text-destructive">{i18n.t("刷新失败，下面是上次读到的数据。")} {failure.text}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {view.counts.map((count) => <div key={count.key} className="rounded-md border p-3">
          <div className="text-2xl font-semibold">{count.value}</div>
          <div className="text-xs text-muted-foreground">{count.label}</div>
        </div>)}
      </div>
      <AmbientJudgeStatus status={read.data.status} />
      {view.hasActivity
        ? <AmbientRecentActivity recent={view.recent} />
        : <StatusState kind="empty" compact title={i18n.t("最近 24 小时还没有记录。")} description={i18n.t("打开插话并有群消息进来后，这里会记录机器人每次接话或不接话。")} />}
    </CardContent>
  </Card>
}

/**
 * 插话判断（ADR 0066 D7 第 4 项）：实际的判断器链（主项 / 备用 / 对照，是否在跳过期）、门槛和
 * 与对照模型的一致率。旧实例不报告链时只说明需要升级。
 */
function AmbientJudgeStatus({ status }: { status: AmbientStatus }) {
  const i18n = useI18n()
  if (!hasMergedJudge(status)) {
    return <p className="text-xs text-muted-foreground" role="note">{i18n.t("这个实例版本较旧，看不到由哪个模型判断。升级 Zhin 后，这里会显示插话判断的模型、备用和对照。")}</p>
  }
  const access = useConsoleAccess()
  const rows = ambientJudgeChainRows(status, i18n.locale)
  const agreement = ambientAgreement(status, i18n.locale)
  const purposesHref = `${CONSOLE_PATHS.ai}?tab=purposes`
  return <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm" data-ambient-judge-status="">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">{i18n.t("插话判断")}</h3>
      {hasConsolePermission('agent.view', access) ? <Button variant="ghost" size="sm" asChild><Link to={purposesHref}>{i18n.t("在用途页修改")}<ArrowUpRight /></Link></Button> : null}
    </div>
    {rows.length ? <ul className="space-y-1" role="list">
      {rows.map(row => <li key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={row.roleCode === 'compare' ? 'secondary' : 'outline'}>{row.role}</Badge>
        <span className="font-medium">{row.label}</span>
        <span className="text-xs text-muted-foreground">{row.kind}</span>
        {row.skipped ? <span className="text-xs text-warning">{row.skipped}</span> : null}
      </li>)}
    </ul> : <p className="text-xs text-muted-foreground">{i18n.t("Agent 尚未加载或未配置判断模型。")}</p>}
    {typeof status.minConfidence === 'number' ? <p className="text-xs text-muted-foreground">{i18n.t("门槛 {0}：判断选「插话」且把握不低于它才开口。", [status.minConfidence])}</p> : null}
    {agreement ? <div className="text-xs text-muted-foreground"><p className="font-medium text-foreground">{agreement.text}</p><p>{agreement.detail}</p></div> : null}
  </div>
}

/** Best-effort group names from connected accounts of the platforms that appear in the records. */
function useAmbientGroupNames(groups: string[]): { names: Map<string, string> | null; failed: boolean } {
  const [names, setNames] = useState<Map<string, string> | null>(null)
  const [failed, setFailed] = useState(false)
  const platforms = [...new Set(groups.map((group) => group.split(':')[0] ?? '').filter(Boolean))].sort().join(',')
  useEffect(() => {
    if (!platforms) return
    let active = true
    setFailed(false)
    const wanted = new Set(platforms.split(','))
    void (async () => {
      const { endpoints = [] } = await requestConsole<{ endpoints?: Array<{ name: string; adapter: string; connected: boolean }> }>({ type: ENDPOINT_RPC.LIST })
      const lists = await Promise.all(endpoints.filter((endpoint) => endpoint.connected && wanted.has(endpoint.adapter)).map((endpoint) =>
        requestConsole<{ groups?: unknown[] }>({ type: ENDPOINT_RPC.GROUPS, adapter: endpoint.adapter, endpointKey: endpoint.name })
          .then((result) => ({ adapter: endpoint.adapter, groups: result.groups ?? [] }))
          .catch(() => null)))
      const next = new Map<string, string>()
      if (active && lists.some((list) => list === null)) setFailed(true)
      for (const list of lists) {
        for (const raw of list?.groups ?? []) {
          if (!raw || typeof raw !== 'object') continue
          const group = normalizeGroupRecord(raw as Record<string, unknown>)
          if (group.group_id && group.name) next.set(`${list!.adapter}:${group.group_id}`, group.name)
        }
      }
      if (active) setNames(next)
    })().catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [platforms])
  return { names, failed }
}

function AmbientRecentActivity({ recent }: { recent: AmbientStatusView['recent'] }) {
  const i18n = useI18n()
  const { names, failed: namesFailed } = useAmbientGroupNames(recent.map((entry) => entry.group))
  const groups = summarizeRecentByGroup(recent, i18n.locale)
  return <div className="space-y-3">
    <h3 className="text-sm font-medium">{i18n.t("最近的记录")}</h3>
    {namesFailed ? <p role="status" className="text-xs text-warning">{i18n.t("群名未能读取，暂以群号显示。")}</p> : null}
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{i18n.t("群")}</TableHead><TableHead>{i18n.t("记录")}</TableHead><TableHead>{i18n.t("最近一次")}</TableHead></TableRow></TableHeader>
        <TableBody>
          {groups.map((row) => {
            const label = ambientGroupLabel(row.group, names)
            return <TableRow key={row.group}>
              <TableCell><span className="block font-medium">{label.name}</span>{label.id ? <span className="console-table-sub">{label.id}</span> : null}</TableCell>
              <TableCell><div className="flex flex-wrap gap-1.5">{row.outcomes.map((item) => <span key={item.outcome} className={`console-outcome-chip is-${item.outcome}`}>{item.label} × {item.count}</span>)}</div></TableCell>
              <TableCell><span className="block">{row.lastText}</span><span className="console-table-sub">{formatTime(row.lastAt, i18n.locale)}</span></TableCell>
            </TableRow>
          })}
        </TableBody>
      </Table>
    </div>
    <details>
      <summary className="text-xs font-medium text-muted-foreground">{i18n.t("逐条记录（{0}）", [recent.length])}</summary>
      <ul className="mt-2 divide-y rounded-md border text-sm">
        {recent.map((entry) => <li key={`${entry.at}-${entry.group}-${entry.outcome}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="text-xs text-muted-foreground">{formatTime(entry.at, i18n.locale)}</span>
          <span className="break-all">{ambientGroupLabel(entry.group, names).name}</span>
          <span className="text-muted-foreground">{entry.text}</span>
        </li>)}
      </ul>
    </details>
  </div>
}

type SettingsReadState = ReturnType<typeof useConsoleRead<SettingsRead | null>>

/** The last save's outcome. Kept above the form: a save re-reads, and the new revision remounts the form. */
type AmbientSaveFeedback =
  | { kind: 'saved'; outcome: ApplyOutcome; mismatch: ReadBackMismatch | null; unverified: boolean }
  | { kind: 'failed'; text: string }

function AmbientSettingsSection({ read, onReload, currentReadEpoch, focusGroup }: { read: SettingsReadState; onReload: () => Promise<SettingsRead | null>; currentReadEpoch: () => number; focusGroup: string | null }) {
  const i18n = useI18n()
  const [lastSave, setLastSave] = useState<AmbientSaveFeedback | null>(null)
  if (read.loading && !read.loaded) return <StatusState kind="loading" onRetry={() => { void onReload().catch(() => {}) }} placeholder={<Skeleton className="h-56 w-full" />} />
  if (read.error && !read.loaded) {
    const failure = describeReadFailure(read.error, i18n.t("群聊插话设置"), i18n.locale)
    return <Card>
      <CardHeader><CardTitle className="text-base">{i18n.t("设置")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {failure.denied
          ? <p>{i18n.t("当前账号不能查看或修改群聊插话设置，只有管理员账号可以修改。")}</p>
          : <StatusState error={read.error} description={failure.text} onRetry={() => { void onReload().catch(() => {}) }} />}
      </CardContent>
    </Card>
  }
  if (!read.data) return null
  return <AmbientSettingsForm key={read.data.revision} initial={read.data} onReload={onReload} currentReadEpoch={currentReadEpoch} focusGroup={focusGroup}
    lastSave={lastSave} onSaved={setLastSave} />
}

function AmbientSettingsForm({ initial, onReload, currentReadEpoch, focusGroup = null, lastSave = null, onSaved }: {
  initial: SettingsRead; onReload: () => Promise<SettingsRead | null>; currentReadEpoch?: () => number; focusGroup?: string | null
  lastSave?: AmbientSaveFeedback | null; onSaved?: (feedback: AmbientSaveFeedback | null) => void
}) {
  const scope = useInboxCacheScope()
  const i18n = useI18n()
  const [behavior, setBehavior] = useState<AmbientBehavior>(initial.settings.behavior)
  const [groupScope, setGroupScope] = useState(initial.settings.groupScope)
  const [groups, setGroups] = useState<string[]>(initial.settings.groups)
  const [maxPerHourText, setMaxPerHourText] = useState(String(initial.settings.maxPerHour))
  const [saving, setSaving] = useState(false)
  const [localFeedback, setLocalFeedback] = useState<AmbientSaveFeedback | null>(null)
  const feedback = lastSave ?? localFeedback
  const setFeedback = (next: AmbientSaveFeedback | null) => { setLocalFeedback(next); onSaved?.(next) }
  const [receipt, setReceipt] = useState<{ value: PatchResult; observedReadEpoch: number } | null>(null)
  const currentReceipt = configurationReceiptForRead(initial, receipt)
  const [serverProblems, setServerProblems] = useState<string[]>([])
  const [judgeWarnings, setJudgeWarnings] = useState<string[]>([])
  const [judgeNote, setJudgeNote] = useState<string | null>(null)

  useEffect(() => {
    setServerProblems([])
  }, [behavior, groupScope, groups, maxPerHourText])

  const draft: AmbientSettings = {
    behavior,
    groupScope,
    groups,
    maxPerHour: Number(maxPerHourText),
  }
  const judge: JudgeSettings = initial.judge ?? { state: 'legacy' }
  // ADR 0066: 「只观察 / 主动参与」 is the judge's mode (`purposes.ambient.mode`). It is written only when
  // the judge was read; an instance whose state is not certain gets nothing written about the mode.
  const modePlan = ambientModePlan(draft, initial.settings.behavior, judge)
  const modeName = (mode: 'active' | 'shadow') => mode === 'shadow' ? i18n.t("只观察") : i18n.t("主动参与")
  const blockedText = modePlan.blocked === 'unknown'
    ? i18n.t("无法确认实例版本或读取插话判断，暂不能修改只观察。")
    : modePlan.blocked === 'no-policy-shadow'
      ? i18n.t("没有读到插话判断的设置，暂不能切到「只观察」：只保存群列表的话，机器人会照常插话。只有 Host 管理员可以修改。")
      : modePlan.blocked === 'no-policy'
        ? i18n.t("没有读到插话判断的设置，暂不能修改「只观察 / 主动参与」。只有 Host 管理员可以修改。")
        : null
  const problems = [...validateAmbientSettings(draft, i18n.locale), ...(blockedText ? [blockedText] : [])]
  const choiceSelectable = (value: AmbientBehavior) => value === 'off' || ambientModePlan({ ...draft, behavior: value }, initial.settings.behavior, judge).blocked === null
  const showsGroupOptions = behavior !== 'off'
  const focusIncluded = focusGroup ? behavior !== 'off' && (groupScope === 'all' || groups.includes(focusGroup)) : false
  const includeFocusGroup = () => {
    if (!focusGroup) return
    if (behavior === 'off') setBehavior('watch')
    if (groupScope === 'all') return
    setGroups(previous => previous.includes(focusGroup) ? previous : [...previous, focusGroup])
  }

  const save = async () => {
    // A blocked mode (or any problem) is never saved, even if the button were bypassed.
    if (!isInboxCacheScopeActive(scope) || problems.length > 0) return
    setSaving(true)
    setFeedback(null)
    setJudgeNote(null)
    // After anything but a clean save the page reads the Host again, so what it shows is what runs.
    const reloadAfterFailure = async () => { await onReload().catch(() => null) }
    let modeApplied = false
    try {
      // The judge's mode first: if it is refused, stale or unconfirmed nothing else is written.
      if (modePlan.judgeMode) {
        let written: Awaited<ReturnType<typeof writeAmbientJudgeMode>>
        try {
          written = await writeAmbientJudgeMode(apiFetch, modePlan.judgeMode, { expected: judge.policy })
        } catch (error) {
          if (!isInboxCacheScopeActive(scope)) return
          await reloadAfterFailure()
          setFeedback({ kind: 'failed', text: i18n.t("「只观察」没有改成：{0}。这次没有保存任何设置。", [inferenceError(error, i18n.locale)]) })
          return
        }
        if (!isInboxCacheScopeActive(scope)) return
        if (written.status !== 'committed') {
          await reloadAfterFailure()
          const code = written.code ?? (written.status === 'conflict' ? 'conflict' : 'unavailable')
          setFeedback({ kind: 'failed', text: written.status === 'stale'
            ? i18n.t("插话判断刚在别处被修改过，这次没有保存任何设置。已重新读取，请确认后再保存。")
            : written.status === 'commit-unknown'
              ? i18n.t("「只观察」的修改尚未确认是否生效，群设置没有保存。已重新读取，请核对当前模式后再保存。")
              : i18n.t("「只观察」没有改成：{0}。这次没有保存任何设置。", [inferenceError(new InferenceRequestError(code), i18n.locale)]) })
          return
        }
        setJudgeWarnings(written.warnings.map(warning => planWarningText(warning, i18n.locale)))
        // Read the mode back: a commit that did not change what runs is not reported as saved.
        const actual = await readAmbientJudgeMode(apiFetch)
        if (!isInboxCacheScopeActive(scope)) return
        if (actual !== modePlan.judgeMode) {
          await reloadAfterFailure()
          setFeedback({ kind: 'failed', text: actual
            ? i18n.t("「只观察」已提交，但读回的模式是「{0}」，与要保存的不一致。群设置没有保存，已重新读取。", [modeName(actual)])
            : i18n.t("「只观察」已提交，但没能读回确认，尚未确认是否生效。群设置没有保存，已重新读取。") })
          return
        }
        modeApplied = true
        setJudgeNote(i18n.t("「{0}」已生效（已读回确认）。", [modeName(modePlan.judgeMode)]))
      }
      const result = await requestConsole<PatchResult>({
        type: 'config:patch',
        expectedRevision: initial.revision,
        patches: buildAmbientPatches(draft, { mergedJudge: !modePlan.writeYmlMode }),
      })
      if (!isInboxCacheScopeActive(scope)) return
      const saveFeedback = describeSaveResult(result, i18n.locale)
      if (result.status === 'saved') setReceipt({ value: result, observedReadEpoch: currentReadEpoch?.() ?? initial.readEpoch ?? 0 })
      if (saveFeedback.kind === 'invalid') {
        const messages = (result.errors ?? []).map((error) => error.message)
        setServerProblems(messages)
      }
      // Every write re-reads; a saved one is then compared with what was submitted.
      const reread = await onReload().catch(() => null)
      if (!isInboxCacheScopeActive(scope)) return
      setFeedback(saveFeedback.kind === 'saved' ? { kind: 'saved', ...ambientSaveOutcome(result, draft, reread, { mergedJudge: !modePlan.writeYmlMode }) }
        : { kind: 'failed', text: modeApplied ? i18n.t("「只观察」已生效，但群设置没有保存：{0}", [saveFeedback.text]) : saveFeedback.text })
    } catch (error) {
      if (!isInboxCacheScopeActive(scope)) return
      await reloadAfterFailure()
      const message = error instanceof InferenceRequestError ? inferenceError(error, i18n.locale) : error instanceof Error ? error.message : String(error)
      setFeedback({ kind: 'failed', text: modeApplied ? i18n.t("「只观察」已生效，但群设置没有保存：{0}", [message]) : i18n.t("保存失败：{0}", [message]) })
    } finally {
      if (isInboxCacheScopeActive(scope)) setSaving(false)
    }
  }


  return <Card>
    <CardHeader>
      <CardTitle className="text-base">{i18n.t("设置")}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-5">
      {focusGroup ? <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm" role="status">
        <span className="min-w-0 flex-1">
          {focusIncluded
            ? groupScope === 'all' ? i18n.t("群 {0} 已包含在「所有群」里。", [focusGroup]) : i18n.t("群 {0} 已在下面的群列表里。", [focusGroup])
            : behavior === 'off' ? i18n.t("插话目前关闭，群 {0} 不会被接话。", [focusGroup]) : i18n.t("群 {0} 不在插话范围里。", [focusGroup])}
        </span>
        {!focusIncluded ? <Button size="sm" variant="outline" onClick={includeFocusGroup}>{behavior === 'off' ? i18n.t("开启只观察并加入这个群") : i18n.t("加入这个群")}</Button> : null}
        {!focusIncluded ? <span className="basis-full text-xs text-muted-foreground">{i18n.t("只改动草稿，保存后才会生效。")}</span> : null}
      </div> : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{i18n.t("机器人要不要自己接话？")}</legend>
        <RadioGroup aria-label={i18n.t("机器人要不要自己接话？")} name="ambient-behavior" value={behavior} onValueChange={value => setBehavior(value as AmbientBehavior)}>
          {BEHAVIOR_CHOICES.map((choice) => <label key={choice.value} className="console-choice-card">
            <RadioGroupItem value={choice.value} className="mt-1" disabled={!choiceSelectable(choice.value)} />
            <span><span className="font-medium">{i18n.t(choice.label, undefined, "state")}</span><span className="block text-xs text-muted-foreground">{i18n.t(choice.hint)}</span></span>
          </label>)}
        </RadioGroup>
        {behavior === 'off' && initial.settings.groups.length > 0 && <p className="text-xs text-muted-foreground">{i18n.t("关闭后会清空下面的群列表，以后重新打开时要再填一次。")}</p>}
        {judge.state === 'merged' && behavior !== 'off' ? <p className="text-xs text-muted-foreground">{i18n.t("「只观察」保存在插话判断里（AI 与模型 → 用途），对所有开启的群生效。")}</p> : null}
        {judge.state === 'unknown' ? <div className="flex flex-wrap items-center gap-2 text-xs text-warning" role="status" data-ambient-mode-unknown="">
          <span>{i18n.t("无法确认实例版本或读取插话判断，暂不能修改只观察。上面显示的是配置文件里的值，不一定是实际生效的模式。")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { void onReload().catch(() => {}) }}>{i18n.t("重新读取")}</Button>
        </div> : null}
      </fieldset>

      {showsGroupOptions && <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{i18n.t("在哪些群里？")}</legend>
        <RadioGroup aria-label={i18n.t("在哪些群里？")} name="ambient-group-scope" value={groupScope} onValueChange={value => setGroupScope(value as AmbientSettings['groupScope'])} className="console-segmented flex gap-1">
        <label>
          <RadioGroupItem value="all" />
          <span>{i18n.t("所有群")}</span></label>
        <label>
          <RadioGroupItem value="some" />
          <span>{i18n.t("只在这些群")}</span></label>
        </RadioGroup>
        {groupScope === 'some' && <AmbientGroupPicker groups={groups} onChange={setGroups} />}
      </fieldset>}

      {showsGroupOptions && <label className="block space-y-1 text-sm">
        <span className="font-medium">{i18n.t("每个群每小时最多插话几次")}</span>
        <Input type="number" min={1} max={60} step={1} value={maxPerHourText} onChange={(event) => setMaxPerHourText(event.target.value)} className="w-32" />
      </label>}

      {[...problems, ...serverProblems].length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
        {[...problems, ...serverProblems].map((problem) => <li key={problem}>{problem}</li>)}
      </ul>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { void save() }} disabled={saving || problems.length > 0}>{saving ? i18n.t("正在保存…") : i18n.t("保存")}</Button>
        {feedback ? feedback.kind === 'saved'
          ? <ApplyFeedback outcome={feedback.outcome} mismatch={feedback.mismatch} unverified={feedback.unverified}
            onRestarted={async () => ambientRestartOutcome(await onReload().catch(() => null))} />
          : <ApplyFeedback failure={{ reason: feedback.text }} /> : null}
      </div>
      {judgeNote ? <p className="text-xs text-muted-foreground" role="status">{judgeNote}</p> : null}
      {judgeWarnings.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-warning" role="status">{judgeWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      <ConfigurationLiveStatus result={currentReceipt ?? initial.application} revision={currentReceipt?.revision ?? initial.revision} />
    </CardContent>
  </Card>
}

