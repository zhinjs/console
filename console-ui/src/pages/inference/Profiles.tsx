import { StatusState } from '../../components/StatusState'
import { useI18n } from '../../i18n'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, ErrorAlert, Input, SelectField, useConfirm } from '@zhin.js/console-ui'
import { ModelCapabilities } from './ModelCapabilities'
import { SupportLabel, SupportNotice, supportLabel } from './SupportInfo'
import { inferenceError, modelEntryView, profileSupport, profileUsages, serviceDriver, type ProfileUsage } from './model.mjs'
import {
  driverKey,
  type Profile,
  type ObjectValue,
  type Kind,
  type ModelDefinition,
} from './model.mjs'
import { SchemaFields } from './SchemaFields'
import type { InferenceManagement, InferenceSource } from './useInferenceManagement'

export function Profiles({ management: m, onCreateAccount }: { management: InferenceManagement; onCreateAccount: () => void }) {
  const i18n = useI18n()
  const view = m.view!,
    [editing, setEditing] = useState<{ profile: Profile | null; source: InferenceSource } | null>(null),
    { confirm, ConfirmDialog: dialog } = useConfirm()
  async function remove(profile: Profile) {
    if (
      await confirm({
        title: i18n.t("删除 {0}？", [profile.label ?? profile.model]),
        description: i18n.t("已使用此模型的用途和会话需要重新选择。"),
        variant: 'destructive',
      })
    )
      await m.savePlan({ version: 1, remove: { profiles: [profile.id] } }, { source: m.source! })
  }
  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{i18n.t("模型", undefined, 'plural')}</h3>
        <Button
          disabled={m.busy || !!m.pending}
          onClick={() => Object.keys(view.accounts).length ? setEditing({ profile: null, source: m.source! }) : onCreateAccount()}
        >
          <Plus />
          {Object.keys(view.accounts).length ? i18n.t("添加模型") : i18n.t("添加账号")}
        </Button>
      </div>
      {!Object.keys(view.profiles).length ? (
        <Card className="p-8 text-center text-muted-foreground">
          {i18n.t("先添加账号，再选择模型。")}
        </Card>
      ) : (
        <ProfileList
          profiles={Object.values(view.profiles)}
          usagesOf={(profile) => profileUsages(view.purposes, profile.id, i18n.locale)}
          row={(profile, usages) => {
            const account = view.accounts[profile.accountId]
            const chat = usages?.some((usage) => usage.key === 'default:chat')
            return (
              <div key={profile.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <SupportLabel
                      label={profile.label ?? profile.model}
                      support={profileSupport(view, profile)}
                    />
                    {chat ? <span className="inline-flex items-center rounded-full border border-[hsl(var(--primary-action-border))] bg-[hsl(var(--primary-action))] px-2 text-[length:var(--console-text-label)] font-medium leading-5 text-[hsl(var(--primary-action-foreground))]">{i18n.t("当前聊天模型")}</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground break-all">
                    {profile.model} · {account.label ?? account.id}
                  </p>
                  {usages?.length ? <ProfileUsageLine usages={usages} /> : null}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("编辑 {0}", [profile.label ?? profile.model])}
                    disabled={m.busy || !!m.pending}
                    onClick={() => setEditing({ profile, source: m.source! })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("删除 {0}", [profile.label ?? profile.model])}
                    disabled={m.busy || !!m.pending}
                    onClick={() => void remove(profile)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            )
          }}
        />
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.profile ? i18n.t("编辑模型") : i18n.t("添加模型")}</DialogTitle>
            <DialogDescription>{i18n.t("同一账号可添加多个模型，无需重复认证。")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <ProfileForm
              key={editing.profile?.id ?? 'new'}
              profile={editing.profile}
              source={editing.source}
              management={m}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
type ProfileSchemaResult =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; schema: Record<string, unknown> }
  | { key: string; status: 'failed'; error: string }

function ProfileForm({
  profile,
  source,
  management,
  onSaved,
}: {
  profile: Profile | null
  source: InferenceSource
  management: InferenceManagement
  onSaved: () => void
}) {
  const i18n = useI18n()
  const view = source.view
  const [accountId, setAccountId] = useState(profile?.accountId ?? '')
  const [label, setLabel] = useState(profile?.label ?? '')
  const [modelId, setModelId] = useState(profile?.model ?? '')
  const [committedModelId, setCommittedModelId] = useState(profile?.model ?? '')
  const [validating, setValidating] = useState(false)
  const [parameters, setParameters] = useState<ObjectValue>(profile?.parameters ?? {})
  const [modelDraft, setModelDraft] = useState<ModelDefinition | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [parametersValid, setParametersValid] = useState(true)
  const [observations, setObservations] = useState<Array<{ id: string; label?: string }>>([])
  const [discovered, setDiscovered] = useState(false)
  const [schemaResult, setSchemaResult] = useState<ProfileSchemaResult | null>(null)
  const [formError, setFormError] = useState('')
  const account = view.accounts[accountId]
  const service = account && view.services[account.serviceId]
  const driver =
    service && view.drivers.find((value) => driverKey(value) === driverKey(service.driver))
  const known = service?.models[modelId]
  const declaration = modelDraft ?? known
  const canEditDeclaration = service?.ownerId === view.ownerId
  const declarationKey = JSON.stringify(declaration)
  const choices = [
    ...new Map(
      [
        ...Object.values(service?.models ?? {}).map((value) => ({ id: value.id, label: value.id })),
        ...observations,
      ].map((value) => [value.id, value])
    ).values(),
  ]
  const disabled = management.busy || !!management.pending
  const entry = modelEntryView({ editing: !!profile, manualEntry, choiceCount: choices.length, discovery: driver?.discovery === true, discovered })

  // Only explicit selection, blur or Save commits an ID for local Driver validation.
  const schemaKey = JSON.stringify([accountId, declarationKey, driver?.contractVersion, view.revision, management.revisionEpoch])
  const currentSchemaKey = useRef(schemaKey)
  currentSchemaKey.current = schemaKey
  const schemaRequest = useRef<{ key: string; promise: Promise<Record<string, unknown> | undefined> } | null>(null)
  function readSchema(): Promise<Record<string, unknown> | undefined> {
    if (!account || !driver || !declaration?.protocol || !declaration.kinds.length) return Promise.resolve(undefined)
    if (schemaResult?.key === schemaKey && schemaResult.status === 'ready') return Promise.resolve(schemaResult.schema)
    if (schemaRequest.current?.key === schemaKey) return schemaRequest.current.promise
    setSchemaResult({ key: schemaKey, status: 'loading' })
    const key = schemaKey
    const promise = management.request<{ inputSchema: Record<string, unknown> }>('/profile-schema', { accountId, model: declaration })
      .then(result => {
        if (schemaRequest.current?.promise !== promise || currentSchemaKey.current !== key || !management.active()) return undefined
        setSchemaResult({ key, status: 'ready', schema: result.inputSchema })
        return result.inputSchema
      })
      .catch(error => {
        if (schemaRequest.current?.promise === promise && currentSchemaKey.current === key && management.active()) {
          setSchemaResult({ key, status: 'failed', error: inferenceError(error, i18n.locale) })
        }
        return undefined
      })
      .finally(() => { if (schemaRequest.current?.promise === promise) schemaRequest.current = null })
    schemaRequest.current = { key, promise }
    return promise
  }
  useEffect(() => {
    if (modelId !== committedModelId || !account || !driver || !declaration?.protocol || !declaration.kinds.length) {
      return
    }
    void readSchema()
  }, [schemaKey, committedModelId])
  useEffect(() => () => { currentSchemaKey.current = '' }, [])

  const currentSchema = modelId === committedModelId && schemaResult?.key === schemaKey ? schemaResult : null
  const schema = currentSchema?.status === 'ready' ? currentSchema.schema : null
  const schemaError = currentSchema?.status === 'failed' ? currentSchema.error : ''

  function chooseModel(id: string, commit = true) {
    if (commit) setCommittedModelId(id)
    setModelId(id)
    const existing = service?.models[id]
    setModelDraft((previous) => existing ? null : previous ? { ...previous, id } : {
      id,
      protocol: driver?.modelContracts.length === 1 ? driver.modelContracts[0].protocol : '',
      kinds: [],
    })
    setFormError('')
  }
  function chooseAccount(id: string) {
    setAccountId(id)
    setModelId('')
    setCommittedModelId('')
    setModelDraft(null)
    setObservations([])
    setDiscovered(false)
  }
  async function discover() {
    if (!account) return
    const result = await management.action<{ observations: Array<{ id: string; label?: string }> }>(
      '/discover',
      { accountId }
    )
    if (result) {
      setObservations(result.observations)
      setDiscovered(true)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || !service) { setFormError(i18n.t("请选择账号。")); return }
    if (!driver) { setFormError(i18n.t("此服务的 Driver 不可用，请检查服务配置。")); return }
    if (!modelId.trim()) { setFormError(i18n.t("请填写模型 ID。")); return }
    if (!declaration?.protocol) { setFormError(i18n.t("请选择模型协议。")); return }
    if (!declaration.kinds.length) { setFormError(i18n.t("请选择模型用途。")); return }
    if (modelDraft && !canEditDeclaration) { setFormError(i18n.t("请在自己可管理的服务中声明模型。")); return }
    if (!parametersValid) { setFormError(i18n.t("请检查生成参数。")); return }
    setFormError('')
    setCommittedModelId(modelId)
    setValidating(true)
    const key = schemaKey
    const checkedSchema = await readSchema()
    if (!checkedSchema || currentSchemaKey.current !== key || !management.active()) {
      setValidating(false)
      return
    }
    const id = profile?.id ?? `profile-${crypto.randomUUID()}`
    const saved = await management.savePlan({
      version: 1,
      ...(modelDraft
        ? {
            services: {
              [service.id]: {
                driver: service.driver,
                options: service.options,
                models: { ...service.models, [modelId]: modelDraft },
                ...(service.label ? { label: service.label } : {}),
              },
            },
          }
        : {}),
      profiles: {
        [id]: { account: account.id, model: modelId, parameters, label: label || modelId },
      },
    }, { source })
    setValidating(false)
    if (saved) onSaved()
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={disabled || validating} className="space-y-4">
        {formError ? <ErrorAlert error={formError} /> : null}
        {management.error ? <ErrorAlert error={management.error} /> : null}
        {driver ? <SupportNotice support={driver.support} /> : null}
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("名称")}</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={i18n.t("如：日常聊天")}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("账号")}</span>
          <SelectField
            disabled={!!profile}
            value={accountId}
            onValueChange={chooseAccount}
            options={[
              { value: '', label: i18n.t("选择账号") },
              ...Object.values(view.accounts).map((value) => ({
                value: value.id,
                label: supportLabel(value.label ?? value.id, serviceDriver(view, value.serviceId)?.support),
              })),
            ]}
          />
        </label>
        {service ? (
          <>
            <label className="block space-y-2 text-sm">
              <span>{i18n.t("模型")}</span>
              {entry.input ? (
                <Input
                  value={modelId}
                  onChange={(event) => chooseModel(event.target.value, false)}
                  onBlur={() => setCommittedModelId(modelId)}
                  required
                  autoComplete="off"
                  placeholder={i18n.t("填写服务的真实模型 ID")}
                />
              ) : (
                <SelectField
                  value={modelId}
                  onValueChange={chooseModel}
                  options={[
                    { value: '', label: i18n.t("选择模型") },
                    ...choices.map((value) => ({
                      value: value.id,
                      label: value.label ?? value.id,
                    })),
                  ]}
                />
              )}
              {entry.hint === 'discoverable' ? <span className="block text-xs text-muted-foreground">{i18n.t("这个服务没有内置模型目录，可以从服务读取，或者手填模型 ID。")}</span>
                : entry.hint === 'manual-only' ? <span className="block text-xs text-muted-foreground">{i18n.t("这个服务没有内置模型目录，请手填模型 ID。")}</span>
                  : entry.hint === 'none-returned' ? <span className="block text-xs text-muted-foreground">{i18n.t("服务没有返回任何模型，请手填模型 ID。")}</span>
                    : null}
            </label>
            <div className="flex flex-wrap gap-2">
              {entry.canToggle ? <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setManualEntry((value) => !value)}
              >
                {manualEntry ? i18n.t("从目录选择") : i18n.t("输入模型 ID")}
              </Button> : null}
              {driver?.discovery === true ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void discover()}>
                  <RefreshCw />
                  {i18n.t("从服务读取模型")}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        {known && canEditDeclaration && !modelDraft ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setModelDraft(structuredClone(known))}
          >
            {i18n.t("调整模型能力")}
          </Button>
        ) : null}
        {modelDraft && driver && canEditDeclaration ? (
          <ModelCapabilities driver={driver} value={modelDraft} onChange={value => { setModelDraft(value); setFormError('') }} />
        ) : null}
        {modelDraft && !canEditDeclaration ? (
          <p role="alert" className="text-sm text-destructive">
            {i18n.t("此服务的模型目录由部署管理员维护；可新增自己的服务声明模型。")}
          </p>
        ) : null}
        {currentSchema?.status === 'loading' ? (
          <StatusState kind="loading" compact title={i18n.t("正在读取生成参数…")} />
        ) : null}
        {schemaError ? (
          <div className="space-y-2">
            <ErrorAlert error={schemaError} />
            <Button
              type="button"
              variant="outline"
              onClick={() => void readSchema()}
            >
              {i18n.t("重新读取参数")}
            </Button>
          </div>
        ) : null}
        {schema ? (
          <fieldset>
            <SchemaFields
              key={`${accountId}:${modelId}`}
              schema={schema}
              value={parameters}
              onChange={setParameters}
              onValidityChange={setParametersValid}
            />
          </fieldset>
        ) : null}
        <Button
          type="submit"
        >
          {i18n.t("保存")}
        </Button>
      </fieldset>
    </form>
  )
}

/**
 * The model list (zhinjs/zhin#1250 `ai-purposes-select`): models a purpose references come first under
 * 「正在使用」 (the default chat model on top); the rest fold into one 「未被用途引用」 disclosure instead of
 * repeating 「还没有用途引用它」 on every row. Without purposes (a personal identity cannot read them)
 * the list stays flat: unknown is not unused.
 */
function ProfileList({ profiles, usagesOf, row }: {
  profiles: Profile[]
  usagesOf: (profile: Profile) => ProfileUsage[] | null
  row: (profile: Profile, usages: ProfileUsage[] | null) => ReactNode
}) {
  const i18n = useI18n()
  const entries = profiles.map((profile) => ({ profile, usages: usagesOf(profile) }))
  // One white panel; inside it only hairlines (console#125: page → panel, no cards inside cards).
  if (entries.some((entry) => entry.usages === null)) {
    return <Card className="console-profile-list divide-y overflow-hidden">{entries.map((entry) => row(entry.profile, entry.usages))}</Card>
  }
  const rank = (usages: ProfileUsage[] | null) => usages?.some((usage) => usage.key === 'default:chat') ? 0 : usages?.some((usage) => usage.level === 'default') ? 1 : 2
  const used = entries.filter((entry) => entry.usages!.length).sort((a, b) => rank(a.usages) - rank(b.usages))
  const unused = entries.filter((entry) => !entry.usages!.length)
  return (
    <Card className="console-profile-list overflow-hidden">
      {used.length ? (
        <section aria-label={i18n.t("正在使用")}>
          <h4 className="px-4 pb-2 pt-3 text-sm font-medium">{i18n.t("正在使用")} <span className="text-muted-foreground">{used.length}</span></h4>
          <div className="divide-y border-t">{used.map((entry) => row(entry.profile, entry.usages))}</div>
        </section>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{i18n.t("还没有用途引用任何模型；在「用途」页签选择聊天等用途使用的模型。")}</p>
      )}
      {unused.length ? (
        <details className="console-profile-unused border-t" open={!used.length}>
          <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground">
            {i18n.t("未被用途引用的模型（{0}）", [unused.length])}
          </summary>
          <div className="divide-y border-t">{unused.map((entry) => row(entry.profile, entry.usages))}</div>
        </details>
      ) : null}
    </Card>
  )
}

/** 「谁在用」：用途配置里引用这个模型的地方；个人身份看不到用途时不显示。 */
function ProfileUsageLine({ usages }: { usages: ProfileUsage[] | null }) {
  const i18n = useI18n()
  if (usages === null) return null
  const shown = usages.slice(0, 4)
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{i18n.t("谁在用：")}</span>
      {usages.length ? shown.map(usage => usage.label).join(' · ') : i18n.t("还没有用途引用它")}
      {usages.length > shown.length ? i18n.t(" 等 {0} 处", [usages.length]) : ''}
      <span className="ml-1">{i18n.t("（在「用途」页签修改）")}</span>
    </p>
  )
}
