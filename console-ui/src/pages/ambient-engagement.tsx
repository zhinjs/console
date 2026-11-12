import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { parse as parseConfigSource } from 'yaml'
import { RefreshCw } from 'lucide-react'
import { ApplyFeedback } from '../components/ApplyFeedback'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ConnectionRequiredState } from '../components/connection-required'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { normalizeGroupRecord } from './endpoint-detail/conversation-labels'
import { pluginRpc } from '../utils/plugin-rpc'
import { useConsoleRead } from '../hooks/use-console-read'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { AmbientGroupPicker } from './AmbientGroupPicker'
import { StatusState } from '../components/StatusState'
import { ScopeFilterBar, useScopeFilter } from './insights/ScopeFilterBar'
import { ambientGroupKey } from './insights/scope-filter.mjs'
import { ConfigurationLiveStatus } from '../components/PluginConfigForm/ConfigurationLiveStatus'
import { configurationReceiptForRead, type ConfigurationApplicationStatus } from '../components/PluginConfigForm/config-live-status.mjs'
import {
  BEHAVIOR_CHOICES,
  ambientGroupLabel,
  buildAmbientPatches,
  describeAmbientStatus,
  describeReadFailure,
  describeSaveResult,
  isPermissionDenied,
  AMBIENT_STATUS_PERMISSION,
  readAmbientSettings,
  summarizeRecentByGroup,
  validateAmbientSettings,
  validateAmbientStatus,
  type AmbientBehavior,
  type AmbientSettings,
  type AmbientStatusView,
  type SaveFeedback,
} from './ambient-engagement-model.mjs'

type ConfigSource = ConfigurationApplicationStatus & { source: string; revision: string }
type StatusRead = { denied: true } | { denied: false; view: AmbientStatusView }
type SettingsRead = { settings: AmbientSettings; revision: string; application?: ConfigurationApplicationStatus; readEpoch?: number }
type PatchResult = ConfigurationApplicationStatus & {
  status?: string
  revision?: string
  errors?: Array<{ path: string; message: string }>
}

async function readAmbientStatus(locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<StatusRead> {
  try {
    const data = await pluginRpc<unknown>('root', 'ambient')
    const status = validateAmbientStatus(data, locale)
    return { denied: false, view: describeAmbientStatus(status, locale) }
  } catch (error) {
    if (isPermissionDenied(error)) return { denied: true }
    throw error
  }
}

async function readAmbientSettingsFromHost(): Promise<SettingsRead> {
  const configSource = await requestConsole<ConfigSource>({ type: 'config:get-source' })
  const configDocument: unknown = parseConfigSource(configSource.source)
  const settings = readAmbientSettings(configDocument)
  return { settings, revision: configSource.revision, application: { application: configSource.application, applicationError: configSource.applicationError } }
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
  if (read.loading && !read.loaded) return <Skeleton className="h-40 w-full" />
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
        {i18n.t("现在：")}<Badge variant={view.behavior === i18n.t('主动参与') ? 'success' : view.behavior === i18n.t('只观察') ? 'info' : 'secondary'}>{view.behavior}</Badge>
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
      {view.hasActivity
        ? <AmbientRecentActivity recent={view.recent} />
        : <StatusState kind="empty" compact title={i18n.t("最近 24 小时还没有记录。")} description={i18n.t("打开插话并有群消息进来后，这里会记录机器人每次接话或不接话。")} />}
    </CardContent>
  </Card>
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
          if (group.group_id > 0 && group.name) next.set(`${list!.adapter}:${group.group_id}`, group.name)
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
          <span className="text-xs text-muted-foreground tabular-nums">{formatTime(entry.at, i18n.locale)}</span>
          <span className="break-all">{ambientGroupLabel(entry.group, names).name}</span>
          <span className="text-muted-foreground">{entry.text}</span>
        </li>)}
      </ul>
    </details>
  </div>
}

type SettingsReadState = ReturnType<typeof useConsoleRead<SettingsRead | null>>

function AmbientSettingsSection({ read, onReload, currentReadEpoch, focusGroup }: { read: SettingsReadState; onReload: () => Promise<SettingsRead | null>; currentReadEpoch: () => number; focusGroup: string | null }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-56 w-full" />
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
  return <AmbientSettingsForm key={read.data.revision} initial={read.data} onReload={onReload} currentReadEpoch={currentReadEpoch} focusGroup={focusGroup} />
}

function AmbientSettingsForm({ initial, onReload, currentReadEpoch, focusGroup = null }: { initial: SettingsRead; onReload: () => Promise<SettingsRead | null>; currentReadEpoch?: () => number; focusGroup?: string | null }) {
  const scope = useInboxCacheScope()
  const i18n = useI18n()
  const [behavior, setBehavior] = useState<AmbientBehavior>(initial.settings.behavior)
  const [groupScope, setGroupScope] = useState(initial.settings.groupScope)
  const [groups, setGroups] = useState<string[]>(initial.settings.groups)
  const [maxPerHourText, setMaxPerHourText] = useState(String(initial.settings.maxPerHour))
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [receipt, setReceipt] = useState<{ value: PatchResult; observedReadEpoch: number } | null>(null)
  const currentReceipt = configurationReceiptForRead(initial, receipt)
  const [serverProblems, setServerProblems] = useState<string[]>([])

  useEffect(() => {
    setServerProblems([])
  }, [behavior, groupScope, groups, maxPerHourText])

  const draft: AmbientSettings = {
    behavior,
    groupScope,
    groups,
    maxPerHour: Number(maxPerHourText),
  }
  const problems = validateAmbientSettings(draft, i18n.locale)
  const showsGroupOptions = behavior !== 'off'
  const focusIncluded = focusGroup ? behavior !== 'off' && (groupScope === 'all' || groups.includes(focusGroup)) : false
  const includeFocusGroup = () => {
    if (!focusGroup) return
    if (behavior === 'off') setBehavior('watch')
    if (groupScope === 'all') return
    setGroups(previous => previous.includes(focusGroup) ? previous : [...previous, focusGroup])
  }

  const save = async () => {
    if (!isInboxCacheScopeActive(scope)) return
    setSaving(true)
    setFeedback(null)
    try {
      const result = await requestConsole<PatchResult>({
        type: 'config:patch',
        expectedRevision: initial.revision,
        patches: buildAmbientPatches(draft),
      })
      if (!isInboxCacheScopeActive(scope)) return
      const saveFeedback = describeSaveResult(result, i18n.locale)
      if (result.status === 'saved') setReceipt({ value: result, observedReadEpoch: currentReadEpoch?.() ?? initial.readEpoch ?? 0 })
      if (saveFeedback.kind === 'invalid') {
        const messages = (result.errors ?? []).map((error) => error.message)
        setServerProblems(messages)
      }
      if (saveFeedback.kind === 'saved' || saveFeedback.kind === 'conflict') {
        await onReload().catch(() => null)
      }
      if (isInboxCacheScopeActive(scope)) setFeedback(saveFeedback)
    } catch (error) {
      if (!isInboxCacheScopeActive(scope)) return
      const message = error instanceof Error ? error.message : String(error)
      setFeedback({ kind: 'error', text: i18n.t("保存失败：{0}", [message]) })
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
            <RadioGroupItem value={choice.value} className="mt-1" />
            <span><span className="font-medium">{i18n.t(choice.label, undefined, "state")}</span><span className="block text-xs text-muted-foreground">{i18n.t(choice.hint)}</span></span>
          </label>)}
        </RadioGroup>
        {behavior === 'off' && initial.settings.groups.length > 0 && <p className="text-xs text-muted-foreground">{i18n.t("关闭后会清空下面的群列表，以后重新打开时要再填一次。")}</p>}
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
        {feedback && <ApplyFeedback feedback={feedback} />}
      </div>
      <ConfigurationLiveStatus result={currentReceipt ?? initial.application} revision={currentReceipt?.revision ?? initial.revision} />
    </CardContent>
  </Card>
}

