import { useI18n } from '../../i18n'
import { useState, type FormEvent } from 'react'
import { Plus, Pencil, KeyRound, LogIn, Unplug, Trash2 } from 'lucide-react'
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
import { SupportLabel, SupportNotice, supportLabel } from './SupportInfo'
import { driverLabel, serviceDriver } from './model.mjs'
import { Card } from '../../components/ui/card'
import { useConfirm } from '../../components/confirm-dialog'
import { driverKey, type Account, type AccountStatus, type ObjectValue } from './model.mjs'
import { SchemaFields } from './SchemaFields'
import type { InferenceManagement, InferenceSource } from './useInferenceManagement'

type Translate = ReturnType<typeof useI18n>['t']
function accountStatusLabel(status: AccountStatus | undefined, t: Translate): string {
  if (status?.status === 'ready' && status.retryAt !== undefined) return t('认证限流')
  if (status?.status === 'uncertain' && status.failure) {
    if (status.failure.kind === 'temporary-response') return t('认证服务暂时不可用')
    if (status.failure.kind === 'transport-unknown') return t('结果待确认')
    return t('认证响应异常')
  }
  switch (status?.status) {
    case 'ready': return t('可用')
    case 'authenticated': return t('待完成准备')
    case 'not-authorized': return t('未授权')
    case 'disconnected': return t('已断开')
    case 'reauthorize': return t('需重新登录')
    case 'uncertain': return t('结果待确认')
    case 'exchange-pending': return t('授权处理中')
    default: return t('状态未知')
  }
}
export function Accounts({ management: m }: { management: InferenceManagement }) {
  const i18n = useI18n()
  const view = m.view!,
    [editing, setEditing] = useState<{
      account?: Account
      replacement?: boolean
      source: InferenceSource
    } | null>(null),
    [credential, setCredential] = useState<{ account: Account; source: InferenceSource } | null>(null)
  const [login, setLogin] = useState<{
    account: Account
    source: InferenceSource
    challenge: { loginId: string; authorizationUrl: string; redirectUri: string }
  } | null>(null)
  const [callback, setCallback] = useState(''),
    [clientSecret, setClientSecret] = useState('')
  const { confirm, ConfirmDialog: dialog } = useConfirm()
  const disabled = m.busy || !!m.pending
  async function disconnect(account: Account) {
    if (
      await confirm({
        title: i18n.t("断开 {0}？", [account.label ?? account.id]),
        description: i18n.t("在途模型请求将取消；账号和模型配置保留。"),
        variant: 'destructive',
      })
    )
      await m.action('/disconnect', {
        accountId: account.id,
        expectedRevision: view.statuses[account.id].revision,
      })
  }
  async function remove(account: Account) {
    const profiles = Object.values(view.profiles).filter(
      (profile) => profile.accountId === account.id
    )
    if (profiles.length) {
      m.setError(i18n.t("请先在模型中删除或调整该账号关联的模型，再删除账号。"))
      return
    }
    if (
      await confirm({
        title: i18n.t("删除 {0}？", [account.label ?? account.id]),
        description: i18n.t("删除后重新新增不会继承原账号身份。"),
        variant: 'destructive',
      })
    )
      await m.savePlan({ version: 1, remove: { accounts: [account.id] } }, { source: m.source! })
  }
  async function begin(account: Account) {
    const challenge = await m.action<{
      loginId: string
      authorizationUrl: string
      redirectUri: string
    }>('/login/begin', { accountId: account.id })
    if (challenge) {
      setLogin({ account, challenge, source: m.source! })
      setCallback('')
    }
  }
  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{i18n.t("账号", undefined, 'plural')}</h3>
        <Button onClick={() => setEditing({ source: m.source! })} disabled={disabled}>
          <Plus />
          {i18n.t("新增账号")}
        </Button>
      </div>
      {!Object.keys(view.accounts).length ? (
        <Card className="p-8 text-center text-muted-foreground">
          {i18n.t("添加一个模型账号，开始配置模型。")}
        </Card>
      ) : (
        <div className="divide-y rounded-lg border">
          {Object.values(view.accounts).map((account) => {
            const service = view.services[account.serviceId],
              status = view.statuses[account.id]
            return (
              <div
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <SupportLabel
                      label={account.label ?? account.id}
                      support={serviceDriver(view, account.serviceId)?.support}
                    />
                  </p>
                  <p className="text-sm text-muted-foreground break-all">
                    {service.label ?? service.driver.id} ·{' '}
                    {accountStatusLabel(status, i18n.t)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ account, source: m.source! })}
                    disabled={disabled}
                  >
                    <Pencil />
                    {i18n.t("编辑")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ account, replacement: true, source: m.source! })}
                    disabled={disabled}
                  >
                    {i18n.t("新增替代账号")}
                  </Button>
                  {account.authentication.method === 'api-key' && !account.authentication.source ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCredential({ account, source: m.source! })}
                      disabled={disabled}
                    >
                      <KeyRound />
                      {i18n.t("设置密钥")}
                    </Button>
                  ) : null}
                  {account.authentication.method === 'oauth' && view.hostAdministrator ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => void begin(account)}
                      >
                        <LogIn />
                        {i18n.t("登录")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => setCredential({ account, source: m.source! })}
                      >
                        {i18n.t("客户端凭据")}
                      </Button>
                      {status?.preparation === 'required' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            void m.action('/login/prepare', {
                              accountId: account.id,
                              expectedRevision: status.revision,
                            })
                          }
                        >
                          {i18n.t("完成准备")}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {account.authentication.method !== 'none' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => void disconnect(account)}
                    >
                      <Unplug />
                      {i18n.t("断开")}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("删除 {0}", [account.label ?? account.id])}
                    disabled={disabled}
                    onClick={() => void remove(account)}
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
            <DialogTitle>
              {editing?.replacement ? i18n.t("新增替代账号") : editing?.account ? i18n.t("编辑账号") : i18n.t("新增账号")}
            </DialogTitle>
            <DialogDescription>
              {editing?.replacement
                ? i18n.t("创建独立账号；原账号保留，模型需明确重新配置。")
                : editing?.account
                ? i18n.t("连接身份变化时，请新增替代账号。")
                : i18n.t("保存配置后再登录或设置密钥。")}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <AccountForm
              key={`${editing.account?.id ?? 'new'}:${editing.replacement ?? false}`}
              account={editing.account}
              replacement={editing.replacement}
              source={editing.source}
              showNotice={!credential && !login}
              management={m}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!credential}
        onOpenChange={(open) => {
          if (!open) {
            setCredential(null)
            setClientSecret('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {credential?.account.authentication.method === 'oauth' ? i18n.t("客户端凭据") : i18n.t("设置 API Key")}
            </DialogTitle>
            <DialogDescription>{credential?.account.label ?? credential?.account.id}</DialogDescription>
          </DialogHeader>
          {m.error ? <ErrorAlert error={m.error} /> : null}
          {credential && !login ? (
            <SupportNotice support={serviceDriver(credential.source.view, credential.account.serviceId)?.support} />
          ) : null}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!credential) return
              const secret = clientSecret
              setClientSecret('')
              const field = credential.account.authentication.method === 'oauth'
                ? 'clientSecret' : 'key'
              if (
                await m.save(
                  field === 'key' ? '/key/prepare' : '/client/prepare',
                  {
                    accountId: credential.account.id,
                    expectedRevision: credential.source.view.statuses[credential.account.id].revision,
                    [field]: secret,
                  },
                  { source: credential.source }
                )
              )
                setCredential(null)
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>
                {credential?.account.authentication.method === 'oauth' ? 'Client Secret' : 'API Key'}
              </span>
              <Input
                type="password"
                autoComplete="off"
                placeholder={credential?.source.view.hostAdministrator && credential.account.authentication.method === 'api-key'
                  ? i18n.t("API Key 或 ${ENV_VAR:-默认值}") : undefined}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={disabled}>
              {i18n.t("保存")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!login}
        onOpenChange={(open) => {
          if (!open) {
            setLogin(null)
            setCallback('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t("登录 {0}", [login?.account.label ?? ''])}</DialogTitle>
            <DialogDescription>{i18n.t("在浏览器中授权后，粘贴最终回调地址。")}</DialogDescription>
          </DialogHeader>
          {m.error ? <ErrorAlert error={m.error} /> : null}
          {login ? (
            <SupportNotice support={serviceDriver(login.source.view, login.account.serviceId)?.support} />
          ) : null}
          {login ? (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault()
                const callbackUrl = callback
                setCallback('')
                if (
                  await m.action('/login/complete', {
                    accountId: login.account.id,
                    loginId: login.challenge.loginId,
                    callbackUrl,
                  })
                ) {
                  setLogin(null)
                }
              }}
            >
              <Button asChild variant="outline">
                <a href={login.challenge.authorizationUrl} target="_blank" rel="noreferrer">
                  {i18n.t("打开授权页面")}
                </a>
              </Button>
              <p className="text-sm text-muted-foreground break-all">
                {i18n.t("回调地址：")}{login.challenge.redirectUri}
              </p>
              <label className="block space-y-2 text-sm">
                <span>{i18n.t("最终回调地址")}</span>
                <Input
                  value={callback}
                  type="url"
                  autoComplete="off"
                  onChange={(event) => setCallback(event.target.value)}
                  required
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={disabled}>
                  {i18n.t("完成登录")}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    await m.action('/login/cancel', {
                      accountId: login.account.id,
                      loginId: login.challenge.loginId,
                    })
                    setLogin(null)
                    setCallback('')
                  }}
                >
                  {i18n.t("取消授权")}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
function AccountForm({
  management: m,
  source,
  showNotice,
  account,
  replacement = false,
  onSaved,
}: {
  management: InferenceManagement
  source: InferenceSource
  showNotice: boolean
  account?: Account
  replacement?: boolean
  onSaved: () => void
}) {
  const i18n = useI18n()
  const view = source.view
  const originalService = account && view.services[account.serviceId]
  const updating = !!account && !replacement
  const [serviceId, setServiceId] = useState(updating ? account.serviceId : '')
  const [driverId, setDriverId] = useState(originalService ? driverKey(originalService.driver) : '')
  const [label, setLabel] = useState(
    account ? `${account.label ?? account.id}${replacement ? i18n.t("（新）") : ''}` : ''
  )
  const [optionsValid, setOptionsValid] = useState(true)
  const [options, setOptions] = useState<ObjectValue>(originalService?.options ?? {})
  const [method, setMethod] = useState(account?.authentication.method ?? '')
  const [authSource, setAuthSource] = useState(!replacement ? account?.authentication.source ?? '' : '')
  const service = view.services[serviceId]
  const driver = view.drivers.find(
    (value) => driverKey(value) === (service ? driverKey(service.driver) : driverId)
  )
  const canEditService = !service || service.ownerId === view.ownerId
  const methods =
    driver?.authentication.filter((value) => view.hostAdministrator || value !== 'oauth') ?? []
  const disabled = m.busy || !!m.pending

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!driver) return
    const targetService = serviceId || `service-${crypto.randomUUID()}`
    const targetAccount = updating ? account!.id : `account-${crypto.randomUUID()}`
    const authentication = updating
      ? account!.authentication
      : { method, ...(method === 'api-key' && authSource ? { source: authSource } : {}) }
    const updateService = !service || (updating && canEditService)
    const saved = await m.savePlan({
      version: 1,
      ...(updateService
        ? {
            services: {
              [targetService]: {
                driver: {
                  id: driver.id,
                  owner: driver.owner,
                  contractVersion: driver.contractVersion,
                },
                options,
                models: service?.models ?? {},
                label: service?.label ?? driver.label,
              },
            },
          }
        : {}),
      accounts: { [targetAccount]: { service: targetService, label, auth: authentication } },
    }, { source })
    if (saved) onSaved()
  }
  function chooseService(id: string) {
    setServiceId(id)
    setMethod('')
    setOptions(view.services[id]?.options ?? {})
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={disabled} className="space-y-4">
        {m.error ? <ErrorAlert error={m.error} /> : null}
        {driver && showNotice ? <SupportNotice support={driver.support} /> : null}
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("账号名称")}</span>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("服务")}</span>
          <SelectField
            disabled={updating}
            value={serviceId}
            onValueChange={chooseService}
            options={[
              { value: '', label: i18n.t("新增服务") },
              ...Object.values(view.services).map((value) => ({
                value: value.id,
                label: supportLabel(value.label ?? value.driver.id, serviceDriver(view, value.id)?.support),
              })),
            ]}
          />
        </label>
        {!service ? (
          <label className="block space-y-2 text-sm">
            <span>{i18n.t("服务类型")}</span>
            <SelectField
              value={driverId}
              onValueChange={(value) => {
                setDriverId(value)
                setOptions({})
                setMethod('')
              }}
              options={[
                { value: '', label: i18n.t("选择服务类型") },
                ...view.drivers
                  .filter(
                    (value) =>
                      view.hostAdministrator ||
                      value.authentication.some((method) => method !== 'oauth')
                  )
                  .map((value) => ({
                    value: driverKey(value),
                    label: supportLabel(driverLabel(value, view.drivers), value.support),
                  })),
              ]}
            />
          </label>
        ) : null}
        {driver && ((updating && canEditService) || !service) ? (
          <section className="space-y-3">
            <h4 className="text-sm font-medium">{i18n.t("服务设置")}</h4>
            {updating &&
            Object.values(view.accounts).filter((value) => value.serviceId === service.id).length >
              1 ? (
              <p className="text-sm text-muted-foreground">
                {i18n.t("此服务设置也会应用于使用它的其他账号。")}
              </p>
            ) : null}
            <SchemaFields
              key={driverKey(driver)}
              schema={driver.serviceSchema}
              value={options}
              onChange={setOptions}
              onValidityChange={setOptionsValid}
            />
          </section>
        ) : null}
        {driver ? (
          <label className="block space-y-2 text-sm">
            <span>{i18n.t("认证方式")}</span>
            <SelectField
              disabled={updating}
              value={method}
              onValueChange={setMethod}
              options={[
                { value: '', label: i18n.t("选择认证方式") },
                ...methods.map((value) => ({
                  value,
                  label:
                    { none: i18n.t("无需认证"), 'api-key': 'API Key', oauth: i18n.t("订阅登录") }[value] ?? value,
                })),
              ]}
            />
          </label>
        ) : null}
        {view.hostAdministrator && method === 'api-key' ? (
          <label className="block space-y-2 text-sm">
            <span>{i18n.t("环境变量引用（可选）")}</span>
            <Input
              disabled={updating}
              value={authSource}
              onChange={(event) => setAuthSource(event.target.value)}
              placeholder="env://MODEL_API_KEY"
              autoComplete="off"
            />
          </label>
        ) : null}
        <Button type="submit" disabled={!optionsValid || !method || !driver}>
          {i18n.t("保存")}
        </Button>
      </fieldset>
    </form>
  )
}
