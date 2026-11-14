import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import * as zhinClient from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { useConfirm } from '../../components/confirm-dialog'

/**
 * The headless account API of `@zhin.js/client` (`AdapterAccountsProvider` / `useAdapterAccounts` /
 * `AdapterAccountEditor`, zhinjs/zhin#1250), typed here for the parts the Console reads so the page
 * also builds and runs against an older client. With an older client `headlessAccounts` is
 * `undefined` and the adapter page keeps the SDK's own account cards under 「管理连接」.
 */
type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface HeadlessAccountRow {
  readonly key: string
  readonly endpointId: string
  readonly instanceId: string
  readonly enabled: boolean
  readonly enabledLabel: string
  readonly retiring: boolean
  readonly state: { readonly label: string; readonly tone: BadgeTone }
  readonly execution?: { readonly label: string; readonly tone: BadgeTone }
  readonly can: { readonly toggle: boolean; readonly edit: boolean; readonly remove: boolean; readonly test: boolean }
  readonly disabled: boolean
  readonly busy: { readonly toggle: boolean; readonly remove: boolean; readonly test: boolean }
  readonly setEnabled: (enabled: boolean) => Promise<void>
  readonly edit: () => void
  readonly remove: () => Promise<void>
}

export interface HeadlessAccounts {
  readonly state: 'loading' | 'error' | 'unmanaged' | 'ready'
  readonly rows: readonly HeadlessAccountRow[]
  readonly readOnly: boolean
  readonly blocked: boolean
  readonly needsMigration: boolean
  readonly canMigrate: boolean
  readonly migrate?: () => Promise<void>
  readonly migration?: { readonly ids: readonly string[]; readonly busy: boolean; readonly confirm: () => Promise<void>; readonly cancel: () => void }
  readonly notice?: { readonly kind: 'ok' | 'error'; readonly message: string; readonly url?: string }
  readonly dismissNotice: () => void
  readonly editing?: { readonly instanceId: string; readonly endpointId: string }
  readonly refresh: () => Promise<void>
}

interface HeadlessApi {
  readonly AdapterAccountsProvider: ComponentType<{ adapterKey: string; refreshKey?: string | number; children?: ReactNode }>
  readonly useAdapterAccounts: () => HeadlessAccounts
  readonly AdapterAccountEditor: ComponentType
}

/** Feature detection: the installed client exports the headless API and the page honours `hostAccounts`. */
export function detectHeadlessAccounts(client: Record<string, unknown>): HeadlessApi | undefined {
  const page = client.AdapterConsolePage as { capabilities?: { hostAccounts?: boolean } } | undefined
  return typeof client.useAdapterAccounts === 'function' && typeof client.AdapterAccountsProvider === 'function'
    && typeof client.AdapterAccountEditor === 'function' && page?.capabilities?.hostAccounts === true
    ? client as unknown as HeadlessApi : undefined
}

export const headlessAccounts = detectHeadlessAccounts(zhinClient as unknown as Record<string, unknown>)

/** The account controller for the adapter page's table, or `undefined` (older client, or no provider). */
const AccountsContext = createContext<HeadlessAccounts | undefined>(undefined)
export const useManagedAccounts = () => useContext(AccountsContext)

function AccountsBridge({ api, children }: { api: HeadlessApi; children?: ReactNode }) {
  const accounts = api.useAdapterAccounts()
  return <AccountsContext.Provider value={accounts}>{children}</AccountsContext.Provider>
}

/**
 * Provides the adapter's managed accounts to the page (only with a client that has the headless API
 * and when the viewer may manage connections); otherwise renders its children unchanged.
 */
export function ManagedAccountsProvider({ adapter, refreshKey, enabled, children }: { adapter: string; refreshKey: number; enabled: boolean; children?: ReactNode }) {
  const api = headlessAccounts
  if (!api || !enabled) return <>{children}</>
  return <api.AdapterAccountsProvider adapterKey={adapter} refreshKey={refreshKey}><AccountsBridge api={api}>{children}</AccountsBridge></api.AdapterAccountsProvider>
}

export function ManagedAccountEditor() {
  const api = headlessAccounts
  return api ? <api.AdapterAccountEditor /> : null
}

const badgeVariant = (tone: BadgeTone) => tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'destructive' : 'outline'

/** State badge of a managed account that is not in the Host's connection list (stopped, closing). */
export function ManagedAccountState({ row }: { row: HeadlessAccountRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={badgeVariant(row.state.tone)} size="sm" className="whitespace-nowrap">{row.state.label}</Badge>
      {row.execution ? <Badge variant={badgeVariant(row.execution.tone)} size="sm" className="whitespace-nowrap">{row.execution.label}</Badge> : null}
    </span>
  )
}

/**
 * The account's start / stop switch with its state as visible text (「运行中 / 已停止」), plus 编辑 and
 * 删除 — the only place these controls appear on the adapter page.
 */
export function ManagedAccountControls({ row }: { row: HeadlessAccountRow }) {
  const i18n = useI18n()
  const { confirm, ConfirmDialog } = useConfirm()
  const remove = async () => {
    const ok = await confirm({
      title: i18n.t('删除账号'),
      description: i18n.t('删除账号「{0}」？账号将关闭，历史保留。', [row.endpointId]),
      confirmLabel: i18n.t('删除'),
      variant: 'destructive',
    })
    if (ok) await row.remove()
  }
  return (
    <>
      {row.can.toggle ? (
        <label className="console-account-switch">
          <Switch checked={row.enabled} disabled={row.disabled} aria-busy={row.busy.toggle || undefined}
            aria-label={i18n.t('{0}：{1}', [row.endpointId, row.enabledLabel])} onCheckedChange={enabled => { void row.setEnabled(enabled) }} />
          <span aria-hidden="true">{row.enabledLabel}</span>
        </label>
      ) : null}
      {row.can.edit ? (
        <Button variant="ghost" size="sm" disabled={row.disabled} onClick={row.edit} aria-label={i18n.t('编辑账号 {0}', [row.endpointId])}>
          <Pencil /><span className="max-md:sr-only">{i18n.t('编辑')}</span>
        </Button>
      ) : null}
      {row.can.remove ? (
        <Button variant="ghost" size="sm" disabled={row.disabled || row.busy.remove} onClick={() => void remove()} aria-label={i18n.t('删除账号 {0}', [row.endpointId])}>
          <Trash2 /><span className="max-md:sr-only">{i18n.t('删除')}</span>
        </Button>
      ) : null}
      {ConfirmDialog}
    </>
  )
}

/** Account-operation status above the table: result notice, migration prompt and confirmation, blocked. */
export function ManagedAccountsStatus({ accounts }: { accounts: HeadlessAccounts }) {
  const i18n = useI18n()
  const { migration, notice } = accounts
  return (
    <>
      {notice ? (
        <Alert variant={notice.kind === 'error' ? 'destructive' : 'success'} role={notice.kind === 'error' ? 'alert' : 'status'} className="console-account-notice">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">{notice.message}</span>
            <Button variant="ghost" size="sm" onClick={accounts.dismissNotice}>{i18n.t('关闭')}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {accounts.blocked ? (
        <Alert variant="destructive" className="console-account-notice">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">{i18n.t('请刷新账号清单后再操作。')}</span>
            <Button variant="outline" size="sm" onClick={() => void accounts.refresh()}>{i18n.t('刷新')}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {migration ? (
        <Alert variant="warning" role="alertdialog" aria-label={i18n.t('确认迁移')} className="console-account-notice">
          <AlertTitle>{i18n.t('确认迁移以下账号并执行本次操作？身份和历史将保留。')}</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs">{migration.ids.join('、')}</p>
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={migration.busy} onClick={() => void migration.confirm()}>{i18n.t('确认迁移')}</Button>
              <Button size="sm" variant="outline" disabled={migration.busy} onClick={migration.cancel}>{i18n.t('取消')}</Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : accounts.needsMigration ? (
        <Alert variant="warning" className="console-account-notice">
          <AlertTitle>{i18n.t('首次修改前需迁移账号，保留身份和历史。')}</AlertTitle>
          <AlertDescription>
            <p>{i18n.t('迁移后账号以数据库为准，配置文件中的 endpoints 不再生效；之后在这里添加、编辑和启停账号。')}</p>
            {!accounts.canMigrate ? <p>{i18n.t('首次迁移需要管理员确认。')}</p>
              : accounts.migrate ? (
                <span className="mt-2 flex"><Button size="sm" disabled={accounts.blocked} onClick={() => void accounts.migrate?.()}>{i18n.t('立即迁移')}</Button></span>
              ) : <p>{i18n.t('第一次编辑或启停账号时会请求确认迁移。')}</p>}
          </AlertDescription>
        </Alert>
      ) : null}
      {accounts.readOnly ? <p className="px-1 text-sm text-muted-foreground">{i18n.t('账号配置存储不可用：当前环境只能查看，不能新增或删除账号。')}</p> : null}
    </>
  )
}
