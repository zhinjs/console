import { StatusState } from '../../components/StatusState'
import { useI18n } from '../../i18n'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Download, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, ErrorAlert, SelectField, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useConfirm } from '@zhin.js/console-ui'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { useInferenceManagement, type InferenceSource, type InferenceManagement } from './useInferenceManagement'
import { Profiles } from './Profiles'
import { Services } from './Services'
import { Accounts } from './Accounts'
import { Purposes } from './Purposes'
import { PersonalSessions } from './PersonalSessions'
import { inferenceFocusAccount, inferenceFocusPurpose, inferencePurposeParams, inferenceTabParams, resolveInferenceTab } from './models-entry.mjs'
import { planWarningText, type PlanWarning } from './ambient-judge-model.mjs'

export function InferenceWorkspace({ connectionScope }: { connectionScope?: string }) {
  const i18n = useI18n()
  const m = useInferenceManagement(connectionScope),
    [importing, setImporting] = useState<InferenceSource | null>(null),
    [source, setSource] = useState(''),
    // Deprecated forms the last import used, converted by the Host (ADR 0066): shown until dismissed.
    [importWarnings, setImportWarnings] = useState<PlanWarning[]>([])
  async function exportPlan() {
    const result = await m.request('/export')
    if (!m.active()) return
    const url = URL.createObjectURL(
        new Blob([stringifyYaml(result)], { type: 'text/yaml;charset=utf-8' })
      ),
      link = document.createElement('a')
    link.href = url
    link.download = 'ai.plan.yml'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        {m.owners.length > 1 ? (
          <SelectField
            className="max-w-md"
            aria-label={i18n.t("模型管理身份")}
            value={m.ownerId}
            onValueChange={m.setOwnerId}
            disabled={m.busy}
            options={m.owners.map((owner) => ({ value: owner.id, label: owner.label }))}
          />
        ) : (
          <h2 className="font-semibold">{m.owners[0]?.label ?? i18n.t("模型", undefined, 'plural')}</h2>
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setImporting(m.source)}
            disabled={!m.canConfigure || !m.view || m.busy || !!m.pending}
          >
            <Upload />
            {i18n.t("导入")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void exportPlan().catch(() => m.setError(i18n.t("导出未完成，请重新读取后再试。")))
            }
            disabled={!m.view || m.busy}
          >
            <Download />
            {i18n.t("导出")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={i18n.t("重新读取模型配置")}
            onClick={() => void m.load()}
            disabled={m.busy}
          >
            <RefreshCw className={m.busy ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
      {m.view && !m.canConfigure ? (
        <Alert role="note" data-inference-read-only="">
          <AlertDescription>{i18n.t("当前身份只能查看，修改模型配置需要 agent.configure 权限。")}</AlertDescription>
        </Alert>
      ) : null}
      {m.error ? <ErrorAlert error={m.error} /> : null}
      {m.pending ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{i18n.t("上次保存结果待确认。")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void m.queryPending()}
              disabled={m.busy}
            >
              {i18n.t("查询保存结果")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {importWarnings.length ? (
        <Alert variant="warning" role="status">
          <AlertTitle>{i18n.t("已导入，有旧写法被换算")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <ul className="list-disc space-y-1 pl-5" role="list">
              {importWarnings.map((warning, index) => <li key={index}>{planWarningText(warning, i18n.locale)}</li>)}
            </ul>
            <Button type="button" size="sm" variant="outline" onClick={() => setImportWarnings([])}>{i18n.t("知道了")}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!connectionScope ? (
        <p role="status" className="text-muted-foreground">
          {i18n.t("请先连接并登录 Host。")}
        </p>
      ) : null}
      {m.view ? (
        <InferencePages key={`${connectionScope}:${m.ownerId}`} management={m} connectionScope={connectionScope} />
      ) : m.busy ? (
        <StatusState kind="loading" compact title={i18n.t("正在读取模型…")} />
      ) : null}
      <Dialog
        open={!!importing}
        onOpenChange={(open) => {
          if (!open) {
            setImporting(null)
            setSource('')
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{i18n.t("导入模型配置")}</DialogTitle>
            <DialogDescription>{i18n.t("粘贴 ai.plan.yml。密钥和登录状态不会随配置导入。")}</DialogDescription>
          </DialogHeader>
          {m.error ? <ErrorAlert error={m.error} /> : null}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                const parsed = parseYaml(source)
                if (importing && await m.savePlan(parsed.plan ?? parsed, {
                  source: importing,
                  bindings: parsed.bindings ?? {},
                  onWarnings: setImportWarnings,
                })) {
                  setImporting(null)
                  setSource('')
                }
              } catch {
                m.setError(i18n.t("配置格式有误，请检查 YAML。"))
              }
            }}
          >
            <Textarea
              aria-label={i18n.t("模型配置 YAML")}
              className="min-h-64 font-mono text-sm"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              required
            />
            <Button type="submit" disabled={!m.canConfigure || m.busy || !!m.pending}>
              {i18n.t("保存")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}


/**
 * The tab lives in the URL (`?tab=`), so refresh and shared links reopen it; `?account=<id>` opens
 * 账号 with that account highlighted (attention items link there). Switching tabs
 * replaces the history entry. A tab the current owner does not have (e.g. purposes for a
 * personal owner) or an unknown value shows the default tab. Editing state remains owned by each page.
 */
function InferencePages({ management: m, connectionScope }: { management: InferenceManagement; connectionScope?: string }) {
  const i18n = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusAccount = inferenceFocusAccount(searchParams.get('account'))
  // `?purpose=` opens 用途 at a section or override row (the 「谁在用」 links on 模型).
  const focusPurpose = inferenceFocusPurpose(searchParams.get('purpose'))
  const tab = resolveInferenceTab(searchParams.get('tab'), m.view?.hostAdministrator, focusAccount)
  // #64 purposes-no-unsaved-guard: switching tabs unmounts 用途 and its draft, so unsaved changes there are asked about first.
  const [purposesDirty, setPurposesDirty] = useState(false)
  const { confirm, ConfirmDialog: leaveTabDialog } = useConfirm()
  const setTab = async (next: string) => {
    if (tab === 'purposes' && next !== 'purposes' && purposesDirty && !(await confirm({
      title: i18n.t("放弃未保存的修改？"),
      description: i18n.t("切换页签后，「用途」里尚未保存的修改将会丢失。"),
      confirmLabel: i18n.t("放弃修改并离开"),
      variant: 'destructive',
    }))) return
    setSearchParams(current => inferenceTabParams(current, next), { replace: true })
  }
  // 「添加模型」 on an account card: switch to 模型 and open its add dialog with that account.
  const [addModelFor, setAddModelFor] = useState<string | null>(null)
  if (!m.view) return null
  return (
        <Tabs value={tab} onValueChange={setTab}>
          {leaveTabDialog}
          <TabsList>
            <TabsTrigger value="profiles">{i18n.t("模型", undefined, 'plural')}</TabsTrigger>
            <TabsTrigger value="accounts">{i18n.t("账号", undefined, 'plural')}</TabsTrigger>
            <TabsTrigger value="services">{i18n.t("服务")}</TabsTrigger>
            {m.view.hostAdministrator ? (
              <TabsTrigger value="purposes">{i18n.t("用途")}</TabsTrigger>
            ) : (
              <TabsTrigger value="sessions">{i18n.t("会话", undefined, 'plural')}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="profiles">
            <Profiles management={m} onCreateAccount={() => setTab('accounts')} addModelFor={addModelFor} onAddModelOpened={() => setAddModelFor(null)}
              onOpenPurpose={m.view.hostAdministrator ? (focus) => setSearchParams(current => inferencePurposeParams(current, focus), { replace: true }) : undefined} />
          </TabsContent>
          <TabsContent value="services"><Services management={m} /></TabsContent>
          <TabsContent value="accounts">
            <Accounts management={m} focusAccount={tab === 'accounts' ? focusAccount : undefined} onAddModel={accountId => { setAddModelFor(accountId); setTab('profiles') }} />
          </TabsContent>
          {m.view.hostAdministrator ? (
            <TabsContent value="purposes">
              <Purposes management={m} focus={tab === 'purposes' ? focusPurpose : undefined} onDirtyChange={setPurposesDirty} />
            </TabsContent>
          ) : (
            <TabsContent value="sessions">
              <PersonalSessions management={m} connectionScope={connectionScope} />
            </TabsContent>
          )}
        </Tabs>
  )
}
