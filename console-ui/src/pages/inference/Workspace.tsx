import { useI18n } from '../../i18n'
import { useState } from 'react'
import { RefreshCw, Download, Upload } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { SelectField } from '../../components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog'
import { ErrorAlert } from '../../components/error-alert'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Textarea } from '../../components/ui/textarea'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { useInferenceManagement, type InferenceSource, type InferenceManagement } from './useInferenceManagement'
import { Profiles } from './Profiles'
import { Services } from './Services'
import { Accounts } from './Accounts'
import { Purposes } from './Purposes'
import { PersonalSessions } from './PersonalSessions'

export function InferenceWorkspace({ connectionScope }: { connectionScope?: string }) {
  const i18n = useI18n()
  const m = useInferenceManagement(connectionScope),
    [importing, setImporting] = useState<InferenceSource | null>(null),
    [source, setSource] = useState('')
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
            disabled={!m.view || m.busy || !!m.pending}
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
      {!connectionScope ? (
        <p role="status" className="text-muted-foreground">
          {i18n.t("请先连接并登录 Host。")}
        </p>
      ) : null}
      {m.view ? (
        <InferencePages key={`${connectionScope}:${m.ownerId}`} management={m} connectionScope={connectionScope} />
      ) : m.busy ? (
        <p role="status" className="text-muted-foreground">
          {i18n.t("正在读取模型…")}
        </p>
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
            <Button type="submit" disabled={m.busy || !!m.pending}>
              {i18n.t("保存")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}


/** A new owner/connection gets a fresh tab selection; editing state remains owned by each page. */
function InferencePages({ management: m, connectionScope }: { management: InferenceManagement; connectionScope?: string }) {
  const i18n = useI18n()
  const [tab, setTab] = useState('profiles')
  if (!m.view) return null
  return (
        <Tabs value={tab} onValueChange={setTab}>
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
            <Profiles management={m} onCreateAccount={() => setTab('accounts')} />
          </TabsContent>
          <TabsContent value="services"><Services management={m} /></TabsContent>
          <TabsContent value="accounts">
            <Accounts management={m} />
          </TabsContent>
          {m.view.hostAdministrator ? (
            <TabsContent value="purposes">
              <Purposes management={m} />
            </TabsContent>
          ) : (
            <TabsContent value="sessions">
              <PersonalSessions management={m} connectionScope={connectionScope} />
            </TabsContent>
          )}
        </Tabs>
  )
}
