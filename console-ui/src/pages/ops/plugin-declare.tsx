import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { KeyRound, Settings2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Textarea } from '../../components/ui/textarea'
import { useToast } from '../../components/toast'
import { SchemaFieldEditor } from '../../components/PluginConfigForm/SchemaFieldEditor'
import type { SchemaEditorDrafts, SchemaField } from '../../components/PluginConfigForm/types.js'
import { objectFields } from '../../components/PluginConfigForm/schema-model.mjs'
import { requestConsole } from '../../utils/console-rpc'
import type { GatewayPluginConfigurationNeed } from '../../contracts/gateway'
import {
  GATEWAY_RPC, GatewayRequestError, declarationConfig, declarationDraft, declareRequestBody, fieldErrorsAt, instanceKeyProblem,
  parseDeclarationJson, readDeclarationErrors, transactionSummary, type DeclarationErrors,
} from './gateway-model.mjs'
import { TransactionProgress } from './ops-components'
import { useGatewayTransaction } from './use-gateway'

type Need = GatewayPluginConfigurationNeed

/**
 * "需要配置" cards for plugins an install left undeclared (`needsConfiguration`, ADR 0053 §2
 * step 4 / ADR 0054 §4). Each opens the declaration form, which calls `gateway.plugins.declare`.
 */
export function ConfigurationNeedsPanel({ needs, disabled, onDeclared, onBusyChange }: {
  needs: readonly Need[]
  disabled?: boolean
  onDeclared: (need: Need) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const i18n = useI18n()
  const [open, setOpen] = useState<Need | null>(null)
  if (!needs.length) return null
  return (
    <section className="space-y-3" aria-label={i18n.t("需要配置的插件")}>
      {needs.map(need => (
        <Card key={need.instanceKey} className="border-warning/60">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />{i18n.t("需要配置")}
                <Badge size="sm" variant="warning">{need.name}</Badge>
              </CardTitle>
              <CardDescription>
                {i18n.t("已安装，但还没有启用：插件需要先填写配置（实例名 {0}）。填写后网关会写入声明并重启实例，失败会恢复原配置。", [need.instanceKey])}
              </CardDescription>
            </div>
            <Button size="sm" disabled={disabled} onClick={() => setOpen(need)}>{i18n.t("填写配置")}</Button>
          </CardHeader>
          {need.missing.length || need.missingEnv.length ? (
            <CardContent className="space-y-2 text-sm">
              {need.missing.length ? (
                <div>
                  <p className="text-muted-foreground">{i18n.t("缺少或需要修正的配置项：")}</p>
                  <ul className="mt-1 flex flex-wrap gap-1" aria-label={i18n.t("缺少的配置项")}>
                    {need.missing.map(path => <li key={path}><Badge size="sm" variant="secondary" className="font-mono">{path || need.instanceKey}</Badge></li>)}
                  </ul>
                </div>
              ) : null}
              {need.missingEnv.length ? (
                <div>
                  <p className="text-muted-foreground">{i18n.t("缺少的环境变量（在「环境变量」页设置后再声明）：")}</p>
                  <ul className="mt-1 flex flex-wrap gap-1" aria-label={i18n.t("缺少的环境变量")}>
                    {need.missingEnv.map(name => <li key={name}><Badge size="sm" variant="warning" className="font-mono"><KeyRound className="mr-1 h-3 w-3" />{name}</Badge></li>)}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ))}
      {open ? (
        <DeclarePluginDialog need={open} onClose={() => setOpen(null)} onBusyChange={onBusyChange}
          onDeclared={need => { setOpen(null); onDeclared(need) }} />
      ) : null}
    </section>
  )
}

type SchemaState = { status: 'loading' } | { status: 'ready'; schema: SchemaField | null; error: string | null }

/** The schema-driven declaration form. Without a Host schema it falls back to a JSON editor. */
export function DeclarePluginDialog({ need, onClose, onDeclared, onBusyChange }: {
  need: Need
  onClose: () => void
  onDeclared: (need: Need) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const i18n = useI18n()
  const toast = useToast()
  const keyId = useId()
  const jsonId = useId()
  const transaction = useGatewayTransaction()
  const [schemaState, setSchemaState] = useState<SchemaState>({ status: 'loading' })
  const [instanceKey, setInstanceKey] = useState(need.instanceKey)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [jsonText, setJsonText] = useState('{}')
  const [errors, setErrors] = useState<DeclarationErrors | null>(null)
  const [localProblem, setLocalProblem] = useState<string | null>(null)
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set())
  const drafts = useRef<SchemaEditorDrafts>({ json: new Map(), unions: new Map(), originals: new Map() })

  useEffect(() => { onBusyChange?.(transaction.running) }, [transaction.running, onBusyChange])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])

  useEffect(() => {
    let cancelled = false
    setSchemaState({ status: 'loading' })
    // An undeclared package may have no schema on this Host yet; the form then edits JSON.
    requestConsole<SchemaField | null>({ type: 'schema:get', pluginName: need.name }).then(schema => {
      if (cancelled) return
      const usable = schema && typeof schema === 'object' && schema.type === 'object' ? schema : null
      const seed = declarationDraft(usable)
      setDraft(seed)
      setJsonText(JSON.stringify(seed, null, 2))
      setSchemaState({ status: 'ready', schema: usable, error: null })
    }, (cause: unknown) => {
      if (cancelled) return
      setSchemaState({ status: 'ready', schema: null, error: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { cancelled = true }
  }, [need.name])

  const fieldValidity = useCallback((path: string, invalid: boolean) => {
    setInvalidFields(previous => {
      if (previous.has(path) === invalid) return previous
      const next = new Set(previous)
      if (invalid) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const schema = schemaState.status === 'ready' ? schemaState.schema : null
  const fields = Object.entries(objectFields(schema)).filter(([, field]) => !field.hidden)
  const keyProblem = instanceKeyProblem(instanceKey, i18n.t)

  const submit = async () => {
    setLocalProblem(null)
    if (keyProblem) return
    const parsed = schema ? declarationConfig(draft, i18n.t) : parseDeclarationJson(jsonText, i18n.t)
    if (!parsed.config) { setLocalProblem(parsed.problem); return }
    if (invalidFields.size) { setLocalProblem(i18n.t("有字段尚未填写正确，请先修正。")); return }
    setErrors(null)
    const body = declareRequestBody({ package: need.name, instanceKey, config: parsed.config })
    const { result, error } = await transaction.run(GATEWAY_RPC.PLUGINS_DECLARE, { ...body }, { keepInvalidInput: true })
    if (error instanceof GatewayRequestError && (error.status === 400 || error.code === 'invalid_input')) {
      // Nothing was touched; keep the draft and show what the schema check reported.
      setErrors(readDeclarationErrors(error.hostMessage || error.message))
      return
    }
    if (result?.status === 'succeeded') {
      toast.success(transactionSummary(result, i18n.t).title)
      onDeclared({ ...need, instanceKey: body.instanceKey })
    }
    // A rolled back declaration stays open with its result; the draft is kept for a retry.
  }

  const running = transaction.running
  const topLevel = new Set(fields.map(([name]) => name))
  const otherErrors = (errors?.fields ?? []).filter(error => !topLevel.has(error.path.split('.')[0] ?? ''))

  return (
    <Dialog open onOpenChange={open => { if (!open && !running) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{i18n.t("配置并启用 {0}", [need.name])}</DialogTitle>
          <DialogDescription>
            {i18n.t("网关会先按插件 Schema 校验，通过后写入声明与这份配置并重启实例；实例起不来会恢复原配置。")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
          <fieldset disabled={running} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor={keyId} className="block text-sm font-medium">{i18n.t("实例名")}</label>
              <Input id={keyId} value={instanceKey} autoComplete="off" spellCheck={false} className="font-mono"
                aria-invalid={keyProblem ? true : undefined} onChange={event => setInstanceKey(event.target.value.trim())} />
              {keyProblem ? <p className="text-xs text-destructive" role="alert">{keyProblem}</p>
                : <p className="text-xs text-muted-foreground">{i18n.t("配置写在根配置的 {0}: 下。", [instanceKey])}</p>}
            </div>
            {need.missingEnv.length ? (
              <Alert variant="warning">
                <AlertTitle>{i18n.t("缺少环境变量")}</AlertTitle>
                <AlertDescription>{i18n.t("默认配置引用了未设置的环境变量：{0}。先在「环境变量」页设置，或在下面改用其他值。", [need.missingEnv.join(', ')])}</AlertDescription>
              </Alert>
            ) : null}
            {errors?.general ? <Alert variant="destructive" role="alert"><AlertDescription>{errors.general}</AlertDescription></Alert> : null}
            {errors && !errors.general ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{i18n.t("配置未通过插件 Schema 校验")}</AlertTitle>
                <AlertDescription className="space-y-1">
                  {otherErrors.map((error, index) => <p key={`${error.path}-${index}`}><span className="font-mono">{error.path || instanceKey}</span> {error.message}</p>)}
                  {errors.missingEnv.length ? <p>{i18n.t("缺少环境变量：{0}", [errors.missingEnv.join(', ')])}</p> : null}
                  {!otherErrors.length && !errors.missingEnv.length ? <p>{i18n.t("请根据字段下方的提示修改。")}</p> : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {schemaState.status === 'loading' ? <Skeleton className="h-40" /> : schema ? (
              <div className="space-y-3">
                {fields.map(([name, field]) => {
                  const fieldErrors = fieldErrorsAt(errors, name)
                  return (
                    <div key={name} className="space-y-1" data-invalid={fieldErrors.length ? true : undefined}>
                      <SchemaFieldEditor name={name} path={`$/${JSON.stringify(name)}`} field={schema.secret ? { ...field, secret: true } : field}
                        value={draft[name]} drafts={drafts.current} onValidityChange={fieldValidity}
                        onChange={value => setDraft(previous => {
                          const next = { ...previous }
                          if (value === undefined) delete next[name]
                          else next[name] = value
                          return next
                        })} />
                      {fieldErrors.map((error, index) => (
                        <p key={`${error.path}-${index}`} className="text-xs text-destructive" role="alert">
                          {error.path !== name ? <span className="font-mono">{error.path} </span> : null}{error.message}
                        </p>
                      ))}
                    </div>
                  )
                })}
                {!fields.length ? <p className="text-sm text-muted-foreground">{i18n.t("此项无需配置。")}</p> : null}
              </div>
            ) : (
              <div className="space-y-1">
                <label htmlFor={jsonId} className="block text-sm font-medium">{i18n.t("配置（JSON 对象）")}</label>
                <p className="text-xs text-muted-foreground">
                  {schemaState.status === 'ready' && schemaState.error
                    ? i18n.t("字段定义读取失败（{0}），请直接填写 JSON。", [schemaState.error])
                    : i18n.t("Host 没有提供此插件的字段定义，请直接填写 JSON；网关仍会按插件 Schema 校验。")}
                </p>
                <Textarea id={jsonId} value={jsonText} spellCheck={false} className="h-56 font-mono text-xs"
                  onChange={event => setJsonText(event.target.value)} />
              </div>
            )}
            {localProblem ? <p className="text-sm text-destructive" role="alert">{localProblem}</p> : null}
          </fieldset>
          {running || transaction.progress.id || transaction.error
            ? <TransactionProgress progress={transaction.progress} running={running} error={transaction.error} /> : null}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" size="sm" disabled={running}>{i18n.t("取消")}</Button></DialogClose>
            <Button type="submit" size="sm" disabled={running || schemaState.status === 'loading' || Boolean(keyProblem)}>
              {running ? i18n.t("正在声明…") : i18n.t("保存并启用")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
