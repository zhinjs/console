import { useI18n } from '../i18n'
import { useState, useRef, useCallback, type ReactNode } from 'react'
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
import { Skeleton } from '../components/ui/skeleton'
import {
  ASSISTANT_TASKS,
  MODE_CHOICES,
  MODE_EXPLANATION,
  buildSkillsPatches,
  describeSaveResult,
  describeSkillsStatus,
  hasSkillsChanges,
  isPermissionDenied,
  readSkillsSettings,
  validateSkillsStatus,
  type SaveFeedback,
  type SkillsSettings,
  type SkillsStatus,
  type TaskModes,
} from './skills-assistant-model.mjs'

type ConfigSource = { source: string; revision: string }
type StatusRead = { denied: true } | { denied: false; status: SkillsStatus }
type SettingsRead = { settings: SkillsSettings; revision: string }
type PatchResult = {
  status?: string
  errors?: Array<{ path: string; message: string }>
}

async function readSkillsStatus(locale: 'zh-CN' | 'en'): Promise<StatusRead> {
  try {
    const data = await pluginRpc<unknown>('root', 'skills')
    const status = validateSkillsStatus(data, locale)
    return { denied: false, status }
  } catch (error) {
    if (isPermissionDenied(error)) return { denied: true }
    throw error
  }
}

async function readSkillsSettingsFromHost(): Promise<SettingsRead> {
  const configSource = await requestConsole<ConfigSource>({ type: 'config:get-source' })
  const configDocument: unknown = parseConfigSource(configSource.source)
  const settings = readSkillsSettings(configDocument)
  return { settings, revision: configSource.revision }
}

function formatTime(timestamp: number, locale: 'zh-CN' | 'en'): string {
  return new Date(timestamp).toLocaleString(locale)
}

export default function SkillsAssistantPage() {
  const i18n = useI18n()
  const messages = useRef(i18n); messages.current = i18n
  const readStatus = useCallback(() => readSkillsStatus(messages.current.locale), [])
  const statusRead = useConsoleRead<StatusRead | null>(readStatus, null)
  const settingsRead = useConsoleRead<SettingsRead | null>(readSkillsSettingsFromHost, null)
  const refreshAll = () => {
    void statusRead.refresh().catch(() => {})
    void settingsRead.refresh().catch(() => {})
  }
  const loading = statusRead.loading || settingsRead.loading
  return <PageShell>
    <PageHeader
      title={i18n.t("技能助手")}
      description={i18n.t("让一个专门的小助手帮机器人挑技能、挑工具、判断要不要接话。")}
      actions={<Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />
    <SkillsStatusSection read={statusRead} onRetry={() => { void statusRead.refresh().catch(() => {}) }} />
    <SkillsSettingsSection read={settingsRead} onReload={() => settingsRead.refresh()} />
  </PageShell>
}

type StatusReadState = ReturnType<typeof useConsoleRead<StatusRead | null>>

function SkillsStatusSection({ read, onRetry }: { read: StatusReadState; onRetry: () => void }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-40 w-full" />
  if (read.error && !read.loaded) {
    return <ErrorAlert error={readErrorSummary(read.error, i18n.t("技能助手状态"))} onRetry={onRetry} />
  }
  if (!read.data) return null
  if (read.data.denied) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{i18n.t("当前账号没有查看技能助手的权限，请联系管理员开通。")}</CardContent></Card>
  }
  const view = describeSkillsStatus(read.data.status, i18n.locale)
  return <Card>
    <CardHeader>
      <CardTitle className="text-base">{i18n.t("最近 24 小时帮了 {0} 次", [view.totalCalls])}{view.failedCalls > 0 ? i18n.t("，其中 {0} 次没成功", [view.failedCalls]) : ''}</CardTitle>
      <CardDescription>{i18n.t("重启机器人后会重新计数。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {read.error && <p className="text-xs text-destructive">{i18n.t("刷新失败，下面是上次读到的数据。")}</p>}
      {view.tasks.length > 0
        ? <div className="grid gap-3 sm:grid-cols-2">
          {view.tasks.map((row) => <div key={row.task} className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.label}</span>
              <Badge variant={row.modeVariant}>{row.mode}</Badge>
            </div>
            <p className="text-muted-foreground">{i18n.t("用了 {0} 次：给出建议 {1} 次，没有合适的 {2} 次", [row.calls, row.helped, row.noSuggestion])}{row.failed > 0 ? i18n.t("，没成功 {0} 次", [row.failed]) : ''}</p>
            <p className="text-xs text-muted-foreground">{i18n.t("平均每次 ")}{row.averageTime}</p>
          </div>)}
        </div>
        : <p className="text-sm text-muted-foreground">{i18n.t("最近 24 小时还没有用到技能助手。")}</p>}
      {view.hasActivity && <div className="space-y-1">
        <h3 className="text-sm font-medium">{i18n.t("最近的记录")}</h3>
        <ul className="divide-y rounded-md border text-sm">
          {view.recent.map((entry) => <li key={`${entry.at}-${entry.label}-${entry.outcome}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="text-xs text-muted-foreground">{formatTime(entry.at, i18n.locale)}</span>
            <span>{entry.label}</span>
            <span className="text-muted-foreground">{entry.text}</span>
            <span className="text-xs text-muted-foreground">{entry.duration}</span>
          </li>)}
        </ul>
      </div>}
    </CardContent>
  </Card>
}

type SettingsReadState = ReturnType<typeof useConsoleRead<SettingsRead | null>>

function SettingsNotice({ children }: { children: ReactNode }) {
  const i18n = useI18n()
  return <Card>
    <CardHeader><CardTitle className="text-base">{i18n.t("设置")}</CardTitle></CardHeader>
    <CardContent className="space-y-2 text-sm text-muted-foreground">{children}</CardContent>
  </Card>
}

function SkillsSettingsSection({ read, onReload }: { read: SettingsReadState; onReload: () => Promise<SettingsRead | null> }) {
  const i18n = useI18n()
  if (read.loading && !read.loaded) return <Skeleton className="h-56 w-full" />
  if (read.error && !read.loaded) {
    return <SettingsNotice>
      <p>{i18n.t("暂时不能在这里修改设置。只有管理员账号可以修改。")}</p>
      <details className="text-xs"><summary className="cursor-pointer">{i18n.t("错误详情")}</summary><p className="mt-2 break-all">{read.error}</p></details>
    </SettingsNotice>
  }
  if (!read.data) return null
  const settings = read.data.settings
  if (!settings.instanceKey) {
    return <SettingsNotice>
      <p>{i18n.t("还没有安装技能助手服务。")}</p>
      <p>{i18n.t("在机器人所在的电脑上运行 ")}<code className="rounded bg-muted px-1">zhin setup --decisions</code>{i18n.t("，按提示填好密钥，然后重启机器人。")}</p>
    </SettingsNotice>
  }
  if (settings.usesOtherService) {
    return <SettingsNotice>
      <p>{i18n.t("现在用的是另一个服务来做这些判断，这个页面不能修改它。需要调整的话，请到「高级 → 配置」里改。")}</p>
    </SettingsNotice>
  }
  return <SkillsSettingsForm key={read.data.revision} initial={read.data} onReload={onReload} />
}

function SkillsSettingsForm({ initial, onReload }: { initial: SettingsRead; onReload: () => Promise<SettingsRead | null> }) {
  const i18n = useI18n()
  const [modes, setModes] = useState<TaskModes>(initial.settings.modes)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [serverProblems, setServerProblems] = useState<string[]>([])
  const changed = hasSkillsChanges(initial.settings, modes)

  const chooseMode = (task: keyof TaskModes, mode: TaskModes[keyof TaskModes]) => {
    setModes((previous) => ({ ...previous, [task]: mode }))
    setServerProblems([])
  }

  const save = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const result = await requestConsole<PatchResult>({
        type: 'config:patch',
        instanceKey: initial.settings.instanceKey,
        expectedRevision: initial.revision,
        patches: buildSkillsPatches(initial.settings, modes),
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
      <CardDescription>{i18n.t(MODE_EXPLANATION)} {i18n.t(" 改完需要重启机器人才会生效。")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="console-setting-list">
      {ASSISTANT_TASKS.map((entry) => <fieldset key={entry.task} className="console-setting-row">
        <div className="min-w-0">
          <legend className="text-sm font-medium">{i18n.t(entry.label)}</legend>
          <p className="mt-0.5 text-xs text-muted-foreground">{i18n.t(entry.hint)}</p>
        </div>
        <div className="console-segmented">
          {MODE_CHOICES.map((choice) => <label key={choice.value}>
            <input
              type="radio"
              name={`skills-mode-${entry.task}`}
              value={choice.value}
              checked={modes[entry.task] === choice.value}
              onChange={() => chooseMode(entry.task, choice.value)}
            />
            <span>{i18n.t(choice.label, undefined, 'state')}</span>
          </label>)}
        </div>
      </fieldset>)}
      </div>

      {serverProblems.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
        {serverProblems.map((problem) => <li key={problem}>{problem}</li>)}
      </ul>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { void save() }} disabled={saving || !changed}>{saving ? i18n.t("正在保存…") : i18n.t("保存")}</Button>
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
