import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog'
import { ErrorAlert } from '../../components/error-alert'
import { ModelCapabilities } from './ModelCapabilities'
import { inferenceError } from './model.mjs'
import { Card } from '../../components/ui/card'
import { useConfirm } from '../../components/confirm-dialog'
import {
  driverKey,
  type Profile,
  type ObjectValue,
  type Kind,
  type ModelDefinition,
} from './model.mjs'
import { SchemaFields } from './SchemaFields'
import type { InferenceManagement, InferenceSource } from './useInferenceManagement'

export function Profiles({ management: m }: { management: InferenceManagement }) {
  const view = m.view!,
    [editing, setEditing] = useState<{ profile: Profile | null; source: InferenceSource } | null>(null),
    { confirm, ConfirmDialog: dialog } = useConfirm()
  async function remove(profile: Profile) {
    if (
      await confirm({
        title: `删除 ${profile.label ?? profile.model}？`,
        description: '已使用此模型的用途和会话需要重新选择。',
        variant: 'destructive',
      })
    )
      await m.savePlan({ version: 1, remove: { profiles: [profile.id] } }, { source: m.source! })
  }
  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">模型</h3>
        <Button
          disabled={m.busy || !!m.pending || !Object.keys(view.accounts).length}
          onClick={() => setEditing({ profile: null, source: m.source! })}
        >
          <Plus />
          添加模型
        </Button>
      </div>
      {!Object.keys(view.profiles).length ? (
        <Card className="p-8 text-center text-muted-foreground">
          先添加账号，再选择模型和生成参数。
        </Card>
      ) : (
        <div className="divide-y rounded-lg border">
          {Object.values(view.profiles).map((profile) => {
            const account = view.accounts[profile.accountId]
            return (
              <div key={profile.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{profile.label ?? profile.model}</p>
                  <p className="text-sm text-muted-foreground break-all">
                    {profile.model} · {account.label ?? account.id}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`编辑 ${profile.label ?? profile.model}`}
                    disabled={m.busy || !!m.pending}
                    onClick={() => setEditing({ profile, source: m.source! })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除 ${profile.label ?? profile.model}`}
                    disabled={m.busy || !!m.pending}
                    onClick={() => void remove(profile)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.profile ? '编辑模型' : '添加模型'}</DialogTitle>
            <DialogDescription>同一账号可添加多个模型，无需重复认证。</DialogDescription>
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
  const view = source.view
  const [accountId, setAccountId] = useState(profile?.accountId ?? '')
  const [label, setLabel] = useState(profile?.label ?? '')
  const [modelId, setModelId] = useState(profile?.model ?? '')
  const [parameters, setParameters] = useState<ObjectValue>(profile?.parameters ?? {})
  const [modelDraft, setModelDraft] = useState<ModelDefinition | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [parametersValid, setParametersValid] = useState(true)
  const [observations, setObservations] = useState<Array<{ id: string; label?: string }>>([])
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null)
  const [schemaState, setSchemaState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [schemaError, setSchemaError] = useState('')
  const [schemaAttempt, setSchemaAttempt] = useState(0)
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

  useEffect(() => {
    if (!account || !driver || !declaration?.protocol || !declaration.kinds.length) {
      setSchemaState('idle')
      return
    }
    let active = true
    setSchemaState('loading')
    setSchemaError('')
    void management
      .request<{ inputSchema: Record<string, unknown> }>('/profile-schema', {
        accountId,
        model: declaration,
      })
      .then((result) => {
        if (active && management.active()) {
          setSchema(result.inputSchema)
          setSchemaState('ready')
        }
      })
      .catch((error) => {
        if (active && management.active()) {
          setSchemaState('failed')
          setSchemaError(inferenceError(error))
        }
      })
    return () => {
      active = false
    }
  }, [
    accountId,
    declarationKey,
    driver?.contractVersion,
    view.revision,
    management.revisionEpoch,
    schemaAttempt,
  ])

  function chooseModel(id: string) {
    setModelId(id)
    const existing = service?.models[id]
    setModelDraft(
      existing
        ? null
        : {
            id,
            protocol: driver?.modelContracts.length === 1 ? driver.modelContracts[0].protocol : '',
            kinds: [],
          }
    )
    setSchemaState('idle')
  }
  function chooseAccount(id: string) {
    setAccountId(id)
    setModelId('')
    setModelDraft(null)
    setSchema(null)
    setSchemaState('idle')
    setObservations([])
  }
  async function discover() {
    if (!account) return
    const result = await management.action<{ observations: Array<{ id: string; label?: string }> }>(
      '/discover',
      { accountId }
    )
    if (result) setObservations(result.observations)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || !service || !driver || !modelId || schemaState !== 'ready') return
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
    if (saved) onSaved()
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={disabled} className="space-y-4">
        {management.error ? <ErrorAlert error={management.error} /> : null}
        <label className="block space-y-2 text-sm">
          <span>名称</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="如：日常聊天"
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span>账号</span>
          <SelectField
            disabled={!!profile}
            value={accountId}
            onValueChange={chooseAccount}
            options={[
              { value: '', label: '选择账号' },
              ...Object.values(view.accounts).map((value) => ({
                value: value.id,
                label: value.label ?? value.id,
              })),
            ]}
          />
        </label>
        {service ? (
          <>
            <label className="block space-y-2 text-sm">
              <span>模型</span>
              {manualEntry || profile ? (
                <Input
                  value={modelId}
                  onChange={(event) => chooseModel(event.target.value)}
                  required
                  autoComplete="off"
                  placeholder="填写服务的真实模型 ID"
                />
              ) : (
                <SelectField
                  value={modelId}
                  onValueChange={chooseModel}
                  options={[
                    { value: '', label: '选择模型' },
                    ...choices.map((value) => ({
                      value: value.id,
                      label: value.label ?? value.id,
                    })),
                  ]}
                />
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setManualEntry((value) => !value)}
              >
                {manualEntry ? '从目录选择' : '输入模型 ID'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void discover()}>
                <RefreshCw />
                从服务读取模型
              </Button>
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
            调整模型能力
          </Button>
        ) : null}
        {modelDraft && driver && canEditDeclaration ? (
          <ModelCapabilities driver={driver} value={modelDraft} onChange={setModelDraft} />
        ) : null}
        {modelDraft && !canEditDeclaration ? (
          <p role="alert" className="text-sm text-destructive">
            此服务的模型目录由部署管理员维护；可新增自己的服务声明模型。
          </p>
        ) : null}
        {schemaState === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取生成参数…
          </p>
        ) : null}
        {schemaError ? (
          <div className="space-y-2">
            <ErrorAlert error={schemaError} />
            <Button
              type="button"
              variant="outline"
              onClick={() => setSchemaAttempt((value) => value + 1)}
            >
              重新读取参数
            </Button>
          </div>
        ) : null}
        {schema ? (
          <fieldset disabled={schemaState !== 'ready'}>
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
          disabled={
            !parametersValid ||
            schemaState !== 'ready' ||
            !account ||
            !modelId ||
            (!!modelDraft && !canEditDeclaration)
          }
        >
          保存
        </Button>
      </fieldset>
    </form>
  )
}
