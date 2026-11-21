import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileDown, FileUp, ShieldOff } from 'lucide-react'
import { resolvePluginId } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle, Badge, Button, useConfirm } from '@zhin.js/console-ui'
import { statusFromError } from '../../components/status-state-model.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { pluginRpc } from '../../utils/plugin-rpc'
import {
  ADAPTER_CONFIG_RPC, adapterConfigPermission, driftEntryActions, driftKindLabel, driftRows, isDriftDivergence, importRequest, readConfigDrift, writebackRequest, writebackResultText,
  type ConfigActionPermission, type ConfigDrift, type ConfigDriftEntry,
} from './config-drift-model.mjs'

interface DriftContext {
  readonly adapter: string
  readonly pluginId: string | null
  readonly drift: ConfigDrift | null
  readonly busy: string | null
  readonly run: (entry: ConfigDriftEntry, action: 'import' | 'writeback') => Promise<void>
}

const ConfigDriftContext = createContext<DriftContext | undefined>(undefined)

/**
 * Reads `endpoint-drift` for one adapter (zhinjs/zhin#1250) and offers 「导入到账号管理」 / 「写回配置文件」
 * to the account table and the drift list below it. A Host without the RPC, or a viewer who may not
 * read it, gets nothing: the table reads as before.
 */
export function ConfigDriftProvider({ adapter, onChanged, children }: { adapter: string; onChanged?: () => void; children?: ReactNode }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const [pluginId, setPluginId] = useState<string | null>(null)
  const [drift, setDrift] = useState<ConfigDrift | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()
  const ticket = useRef(0)
  const readable = pluginId ? adapterConfigPermission(pluginId, ADAPTER_CONFIG_RPC.DRIFT, undefined, access).allowed : false

  useEffect(() => {
    let active = true
    setPluginId(null)
    setDrift(null)
    void resolvePluginId({ adapter }).then(id => { if (active) setPluginId(id ?? null) }, () => { if (active) setPluginId(null) })
    return () => { active = false }
  }, [adapter])

  const load = useCallback(async () => {
    const current = ++ticket.current
    if (!pluginId || !readable) { setDrift(null); return }
    try {
      const value = readConfigDrift(await pluginRpc<unknown>(pluginId, ADAPTER_CONFIG_RPC.DRIFT))
      if (current === ticket.current) setDrift(value)
    } catch {
      // Older Hosts have no `endpoint-drift`; any failure leaves the table as it was.
      if (current === ticket.current) setDrift(null)
    }
  }, [pluginId, readable])
  useEffect(() => { void load(); return () => { ticket.current += 1 } }, [load])

  const run = useCallback(async (entry: ConfigDriftEntry, action: 'import' | 'writeback') => {
    if (!pluginId || !drift || busy) return
    const ok = await confirm(action === 'import'
      ? {
        title: i18n.t('从配置文件导入账号 {0}', [entry.id]),
        description: entry.kind === 'config_only'
          ? i18n.t('把 zhin.config.yml 里的账号 {0} 加入账号管理，之后可以在这里启动、停止和编辑。导入后不会自动启动。', [entry.id])
          : i18n.t('用 zhin.config.yml 里的配置覆盖已保存的账号 {0}。Console 里对它做过的修改会被替换。', [entry.id]),
        confirmLabel: i18n.t('导入'),
      }
      : {
        title: i18n.t('把账号 {0} 写回配置文件', [entry.id]),
        description: i18n.t('用已保存的账号 {0} 改写 zhin.config.yml。该适配器的全部账号会随配置重载重新连接；密钥只写成 ${变量} 引用。', [entry.id]),
        confirmLabel: i18n.t('写回'),
        variant: 'destructive' as const,
      })
    if (!ok) return
    setBusy(`${action}\u0000${entry.id}`)
    setNotice(null)
    try {
      if (action === 'import') {
        await pluginRpc<unknown>(pluginId, ADAPTER_CONFIG_RPC.IMPORT, importRequest(drift, entry.id))
        setNotice({ kind: 'success', text: i18n.t('已从配置文件导入账号 {0}，尚未启动。', [entry.id]) })
      } else {
        const result = await pluginRpc<unknown>(pluginId, ADAPTER_CONFIG_RPC.WRITEBACK, writebackRequest(drift, [entry.id]))
        setNotice({ kind: 'success', text: writebackResultText(result, i18n.locale) })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: statusFromError(error).message || i18n.t('操作没有完成，请刷新后重试。') })
    } finally {
      setBusy(null)
      await load()
      onChanged?.()
    }
  }, [pluginId, drift, busy, confirm, i18n, load, onChanged])

  return (
    <ConfigDriftContext.Provider value={{ adapter, pluginId, drift, busy, run }}>
      {notice ? (
        <Alert variant={notice.kind === 'error' ? 'destructive' : 'success'} role={notice.kind === 'error' ? 'alert' : 'status'} className="console-account-notice">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">{notice.text}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>{i18n.t('关闭')}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {children}
      {ConfirmDialog}
    </ConfigDriftContext.Provider>
  )
}

/** One drift action: its button, or the no-permission state naming what is missing. */
function DriftActionButton({ entry, action, permission }: { entry: ConfigDriftEntry; action: 'import' | 'writeback'; permission: ConfigActionPermission }) {
  const i18n = useI18n()
  const context = useContext(ConfigDriftContext)
  const label = action === 'import' ? i18n.t('导入到账号管理') : i18n.t('写回配置文件')
  if (!permission.allowed) {
    return (
      <Badge variant="outline" size="sm" className="whitespace-nowrap" title={i18n.t('需要权限：{0}', [permission.missing.join(', ')])}>
        <ShieldOff aria-hidden="true" />{action === 'import' ? i18n.t('无权导入') : i18n.t('无权写回')}
      </Badge>
    )
  }
  const pending = context?.busy === `${action}\u0000${entry.id}`
  return (
    <Button variant="outline" size="sm" disabled={Boolean(context?.busy)} aria-busy={pending || undefined}
      aria-label={`${label} · ${entry.id}`} onClick={() => { void context?.run(entry, action) }}>
      {action === 'import' ? <FileDown /> : <FileUp />}{label}
    </Button>
  )
}

/**
 * Action slot of an account that exists only in configuration (not running) in the adapter's
 * 聊天账号 table: 「导入到账号管理」 when the Host reports it as only in the file and can import it.
 * Empty on Hosts without `endpoint-drift`.
 */
export function ConfiguredAccountActions({ endpoint }: { adapter: string; endpoint: string }): ReactNode {
  const access = useConsoleAccess()
  const context = useContext(ConfigDriftContext)
  const entry = context?.drift?.entries.find(item => item.id === endpoint && item.kind === 'config_only')
  if (!context || !entry) return null
  const actions = driftEntryActions(context.drift, entry, context.pluginId, access)
  return actions.import ? <DriftActionButton entry={entry} action="import" permission={actions.import} /> : null
}

/**
 * Accounts whose managed copy and `zhin.config.yml` disagree (changed, or saved but missing from the
 * file), with 「导入到账号管理」 / 「写回配置文件」. Nothing when there is no drift or no drift read.
 */
export function ConfigDriftSection() {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const context = useContext(ConfigDriftContext)
  const rows = driftRows(context?.drift)
  const unverified = context?.drift?.unverified ?? []
  if (!context?.drift || (!rows.length && !unverified.length)) return null
  // Accounts added in the Console are not drift (#1250 第 88 批): alone they get a neutral note, still with 「写回配置文件」.
  const consoleAddedOnly = !unverified.length && rows.every(entry => !isDriftDivergence(entry))
  return (
    <Alert variant={consoleAddedOnly ? 'default' : 'warning'} className="console-account-notice">
      <AlertTitle>{consoleAddedOnly ? i18n.t('Console 新增的账号还没写进配置文件') : i18n.t('账号与配置文件不一致')}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{consoleAddedOnly
          ? i18n.t('这些账号是在 Console 里新增的，按已保存的账号照常运行；需要让 zhin.config.yml 也记下它们时，写回配置文件。')
          : i18n.t('Console 管理的账号以已保存的为准，zhin.config.yml 里的改动不会自动生效。逐个选择以哪一份为准。')}</p>
        {rows.length ? <ul className="space-y-2">
          {rows.map(entry => {
            const actions = driftEntryActions(context.drift, entry, context.pluginId, access)
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <code className="break-all">{entry.id}</code>
                <Badge variant={isDriftDivergence(entry) ? 'warning' : 'secondary'} size="sm">{driftKindLabel(entry.kind, i18n.locale, entry.origin)}</Badge>
                {entry.fields.length ? <span className="min-w-0 break-all text-xs" title={entry.fields.map(field => field.path).join(', ')}>
                  {i18n.t('不同的字段：{0}', [entry.fields.map(field => field.sensitive ? i18n.t('{0}（密钥）', [field.path]) : field.path).join(i18n.t('、'))])}
                </span> : null}
                <span className="flex-1" />
                {actions.import ? <DriftActionButton entry={entry} action="import" permission={actions.import} /> : null}
                {actions.writeback ? <DriftActionButton entry={entry} action="writeback" permission={actions.writeback} /> : null}
              </li>
            )
          })}
        </ul> : null}
        {unverified.length ? <p className="text-xs">{i18n.t('无法核对：{0}（配置文件写的是 ${变量} 引用，已保存的账号存有实际值）。', [unverified.map(item => `${item.id}: ${item.paths.join(', ')}`).join('; ')])}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
