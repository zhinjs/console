import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useEffect, useState } from 'react'
import { parse as parseConfigSource } from 'yaml'
import { RefreshCw, RotateCw } from 'lucide-react'
import { requestConsole } from '../utils/console-rpc'
import { pluginRpc } from '../utils/plugin-rpc'
import { readErrorSummary } from '../utils/read-error.mjs'
import { useConsoleRead } from '../hooks/use-console-read'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Skeleton } from '../components/ui/skeleton'
import {
  BEHAVIOR_CHOICES,
  buildAmbientPatches,
  describeAmbientStatus,
  describeSaveResult,
  isPermissionDenied,
  parseGroupList,
  readAmbientSettings,
  validateAmbientSettings,
  validateAmbientStatus,
  type AmbientBehavior,
  type AmbientSettings,
  type AmbientStatusView,
  type SaveFeedback,
} from './ambient-engagement-model.mjs'

type ConfigSource = { source: string; revision: string }
type StatusRead = { denied: true } | { denied: false; view: AmbientStatusView }
type SettingsRead = { settings: AmbientSettings; revision: string }
type PatchResult = {
  status?: string
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
  return { settings, revision: configSource.revision }
}

function formatTime(timestamp: number, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return new Date(timestamp).toLocaleString(locale)
}

export default function AmbientEngagementPage() {
  const i18n = useI18n()
  const statusRead = useConsoleRead<StatusRead | null>(readAmbientStatus, null)
  const settingsRead = useConsoleRead<SettingsRead | null>(readAmbientSettingsFromHost, null)
  const refreshAll = () => {
    void statusRead.refresh().catch(() => {})
    void settingsRead.refresh().catch(() => {})
  }
  const loading = statusRead.loading || settingsRead.loading
  return <PageShell>
    <PageHeader
      title={i18n.t("群聊插话")}
      description={i18n.t("没人 @ 机器人的时候，它要不要自己在群里接话。")}
      actions={<Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />
    <AmbientStatusSection read={statusRead} onRetry={() => { void statusRead.refresh().catch(() => {}) }} />
    <AmbientSettingsSection
      read={settingsRead}
      onReload={() => settingsRead.refresh()}
    />
  </PageShell>
}

type StatusReadState = ReturnType<typeof useConsoleRead<StatusRead | null>>

function AmbientStatusSection({ read, onRetry }: { read: StatusReadState; onRetry: () => void }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-40 w-full" />
  if (read.error && !read.loaded) {
    return <ErrorAlert error={readErrorSummary(read.error, i18n.t("群聊插话状态"), i18n.locale)} onRetry={onRetry} />
  }
  if (!read.data) return null
  if (read.data.denied) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{i18n.t("当前账号没有查看群聊插话的权限，请联系管理员开通。")}</CardContent></Card>
  }
  const view = read.data.view
  return <Card>
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
        {i18n.t("现在：")}<Badge variant={view.behavior === i18n.t('主动参与') ? 'success' : view.behavior === i18n.t('只观察') ? 'info' : 'secondary'}>{view.behavior}</Badge>
        <span className="text-sm font-normal text-muted-foreground">{i18n.t("范围：")}{view.groupScope}</span>
      </CardTitle>
      <CardDescription>{i18n.t("下面是最近 24 小时的情况。重启机器人后会重新计数。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {read.error && <p className="text-xs text-destructive">{i18n.t("刷新失败，下面是上次读到的数据。")}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {view.counts.map((count) => <div key={count.key} className="rounded-md border p-3">
          <div className="text-2xl font-semibold">{count.value}</div>
          <div className="text-xs text-muted-foreground">{count.label}</div>
        </div>)}
      </div>
      {view.hasActivity
        ? <div className="space-y-1">
          <h3 className="text-sm font-medium">{i18n.t("最近的记录")}</h3>
          <ul className="divide-y rounded-md border text-sm">
            {view.recent.map((entry) => <li key={`${entry.at}-${entry.group}-${entry.outcome}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="text-xs text-muted-foreground">{formatTime(entry.at, i18n.locale)}</span>
              <span className="break-all">{entry.group}</span>
              <span className="text-muted-foreground">{entry.text}</span>
            </li>)}
          </ul>
        </div>
        : <p className="text-sm text-muted-foreground">{i18n.t("最近 24 小时还没有记录。")}</p>}
    </CardContent>
  </Card>
}

type SettingsReadState = ReturnType<typeof useConsoleRead<SettingsRead | null>>

function AmbientSettingsSection({ read, onReload }: { read: SettingsReadState; onReload: () => Promise<SettingsRead | null> }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-56 w-full" />
  if (read.error && !read.loaded) {
    return <Card>
      <CardHeader><CardTitle className="text-base">{i18n.t("设置")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>{i18n.t("暂时不能在这里修改设置。只有管理员账号可以修改。")}</p>
        <details className="text-xs"><summary className="cursor-pointer">{i18n.t("错误详情")}</summary><p className="mt-2 break-all">{read.error}</p></details>
      </CardContent>
    </Card>
  }
  if (!read.data) return null
  return <AmbientSettingsForm key={read.data.revision} initial={read.data} onReload={onReload} />
}

function AmbientSettingsForm({ initial, onReload }: { initial: SettingsRead; onReload: () => Promise<SettingsRead | null> }) {
  const i18n = useI18n()
  const [behavior, setBehavior] = useState<AmbientBehavior>(initial.settings.behavior)
  const [groupScope, setGroupScope] = useState(initial.settings.groupScope)
  const [groupText, setGroupText] = useState(initial.settings.groups.join('\n'))
  const [maxPerHourText, setMaxPerHourText] = useState(String(initial.settings.maxPerHour))
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [serverProblems, setServerProblems] = useState<string[]>([])

  useEffect(() => {
    setServerProblems([])
  }, [behavior, groupScope, groupText, maxPerHourText])

  const draft: AmbientSettings = {
    behavior,
    groupScope,
    groups: parseGroupList(groupText),
    maxPerHour: Number(maxPerHourText),
  }
  const problems = validateAmbientSettings(draft, i18n.locale)
  const showsGroupOptions = behavior !== 'off'

  const save = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const result = await requestConsole<PatchResult>({
        type: 'config:patch',
        expectedRevision: initial.revision,
        patches: buildAmbientPatches(draft),
      })
      const saveFeedback = describeSaveResult(result, i18n.locale)
      if (saveFeedback.kind === 'invalid') {
        const messages = (result.errors ?? []).map((error) => error.message)
        setServerProblems(messages)
      }
      if (saveFeedback.kind === 'saved' || saveFeedback.kind === 'conflict') {
        await onReload().catch(() => null)
      }
      setFeedback(saveFeedback)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback({ kind: 'error', text: i18n.t("保存失败：{0}", [message]) })
    } finally {
      setSaving(false)
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle className="text-base">{i18n.t("设置")}</CardTitle>
      <CardDescription>{i18n.t("改完需要重启机器人才会生效。冷却时间等更细的调整，请到「高级 → 配置」里改。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{i18n.t("机器人要不要自己接话？")}</legend>
        {BEHAVIOR_CHOICES.map((choice) => <label key={choice.value} className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
          <input type="radio" name="ambient-behavior" value={choice.value} checked={behavior === choice.value} onChange={() => setBehavior(choice.value)} className="mt-1" />
          <span><span className="font-medium">{i18n.t(choice.label, undefined, "state")}</span><span className="block text-xs text-muted-foreground">{i18n.t(choice.hint)}</span></span>
        </label>)}
        {behavior === 'off' && initial.settings.groups.length > 0 && <p className="text-xs text-muted-foreground">{i18n.t("关闭后会清空下面的群列表，以后重新打开时要再填一次。")}</p>}
      </fieldset>

      {showsGroupOptions && <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{i18n.t("在哪些群里？")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="ambient-group-scope" value="all" checked={groupScope === 'all'} onChange={() => setGroupScope('all')} />
          {i18n.t("所有群")}</label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="ambient-group-scope" value="some" checked={groupScope === 'some'} onChange={() => setGroupScope('some')} />
          {i18n.t("只在这些群")}</label>
        {groupScope === 'some' && <Textarea
          aria-label={i18n.t("群列表")}
          placeholder={i18n.t("每行一个，写成「平台:群号」，例如\nqq:123456")}
          value={groupText}
          onChange={(event) => setGroupText(event.target.value)}
          rows={4}
        />}
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
        {feedback && <SaveFeedbackNotice feedback={feedback} />}
      </div>
    </CardContent>
  </Card>
}

function SaveFeedbackNotice({ feedback }: { feedback: SaveFeedback }) {
  if (feedback.kind === 'saved') {
    return <span className="flex items-center gap-1 text-sm">
      {feedback.restartRequired && <RotateCw className="size-4 text-amber-600" />}
      <span className={feedback.restartRequired ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{feedback.text}</span>
    </span>
  }
  return <span className="text-sm text-destructive">{feedback.text}</span>
}

