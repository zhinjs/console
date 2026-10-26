import { useI18n } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/button'
import { PluginManagementSummary } from '../../pages/PluginManagementSummary'
import { applyRequest, canApplyPlugin, validateManagementState, waitForManagementState, type PluginManagementState } from '../../pages/plugin-management-model.mjs'
import { configEvidenceMatches, readPendingConfigApplication, rememberConfigApplication, forgetConfigApplication, configApplicationConfirmed, type PendingConfigApplication } from './config-evidence-model.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { useConfirm } from '../confirm-dialog'

type Props = { pluginName: string; revision?: string; draftRevision?: string; dirty: boolean; disabled?: boolean; managed: boolean }

export function ConfigApplicationEvidence(props: Props) {
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return null
  return <EvidenceSession key={JSON.stringify([scope, props.pluginName])} {...props} scope={scope} />
}

function EvidenceSession({ pluginName, revision, draftRevision, dirty, disabled, managed, scope }: Props & { scope: string }) {
  const i18n = useI18n()
  const [retained] = useState(() => readPendingConfigApplication(scope, pluginName))
  const [evidence, setEvidence] = useState<PluginManagementState | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(retained.status !== 'none')
  const operation = useRef(0)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const approved = useRef<PendingConfigApplication | null>(retained.status === 'pending' ? retained.pending : null)
  const latest = useRef({ revision, dirty, disabled, managed })
  latest.current = { revision, dirty, disabled, managed }
  const { confirm, ConfirmDialog } = useConfirm()
  const bound = configEvidenceMatches(evidence, pluginName, revision, i18n.locale)
  const current = (id: number) => operation.current === id && isInboxCacheScopeActive(scope)

  const read = async () => {
    if (!managed || !revision || !isInboxCacheScopeActive(scope) || inFlight.current) return
    const id = ++operation.current, expected = revision
    inFlight.current = true
    setLoading(true); setError(null)
    try {
      const state = validateManagementState(await requestConsole({ type: 'plugin:inspect', instanceKey: pluginName }), pluginName, i18n.locale)
      if (!current(id) || latest.current.revision !== expected) return
      setEvidence(state)
      const previous = approved.current
      if (configApplicationConfirmed(state, previous)) {
        forgetConfigApplication(scope, pluginName); setUnconfirmed(false); approved.current = null; setNotice(i18n.t("只读核对确认：当前代的包与配置语义一致；业务功能仍需独立验证。"))
      }
    } catch { if (current(id)) { setEvidence(null); setError(i18n.t("应用证据暂无法确认，请重新读取或查看日志；这不表示配置保存失败，也不能判定应用失败。")) } }
    finally { if (current(id)) { inFlight.current = false; setLoading(false) } }
  }

  useEffect(() => {
    operation.current++; inFlight.current = false; controller.current?.abort(); setEvidence(null); setError(null); setLoading(false)
    if (approved.current) { setUnconfirmed(true); setNotice(i18n.t("原应用申请结果尚未确认；请先只读核对，勿重复申请。")) }
    else if (retained.status === 'unavailable') { setUnconfirmed(true); setNotice(i18n.t("无法读取会话中的待确认申请记录；当前暂停申请应用，请恢复会话存储后重新打开配置页。")) }
    else setNotice(null)
    return () => { operation.current++; controller.current?.abort() }
  }, [revision, managed, scope, pluginName])

  const apply = async () => {
    if (!bound || !evidence || dirty || disabled || inFlight.current || unconfirmed || !canApplyPlugin(evidence) || !isInboxCacheScopeActive(scope)) return
    const previous = evidence, expected = revision, id = ++operation.current
    inFlight.current = true
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setLoading(true); setError(null); setNotice(null)
    let attemptedDispatch = false
    try {
      if (!await confirm({ title: i18n.t("应用已保存的插件配置？"), description: i18n.t("{0} · 文件版本 {1}。Host 将申请应用/重启；后续只读状态核对才能确认。", [pluginName, expected?.slice(0, 12)]), confirmLabel: i18n.t("申请应用") })) return
      if (!current(id) || latest.current.revision !== expected || latest.current.dirty || latest.current.disabled || abort.signal.aborted) return
      const request = applyRequest(previous, i18n.locale)
      approved.current = rememberConfigApplication(scope, previous, undefined, i18n.locale)
      attemptedDispatch = true
      try { await requestConsole(request) }
      catch { if (current(id)) setNotice(i18n.t("应用回执未确认，正在只读核对；不会重复提交申请。")) }
      if (!current(id) || abort.signal.aborted) return
      const result = await waitForManagementState(() => requestConsole({ type: 'plugin:inspect', instanceKey: pluginName }), previous, abort.signal, undefined, i18n.locale)
      if (!current(id) || latest.current.revision !== expected || abort.signal.aborted) return
      if (!result || !configApplicationConfirmed(result, approved.current)) { setUnconfirmed(true); setNotice(i18n.t("应用结果未知。请恢复连接后重新读取证据或查看日志；勿重复申请。")); return }
      forgetConfigApplication(scope, pluginName); approved.current = null; setUnconfirmed(false); setEvidence(result)
      setNotice(result.disabled ? i18n.t("已核对：实例已停用。") : i18n.t("已核对：当前代的包与已保存配置语义一致；业务功能仍需独立验证。"))
    } catch { if (current(id)) {
      if (attemptedDispatch) { setUnconfirmed(true); setError(i18n.t("应用结果未确认，请只读核对当前状态，勿重复申请。")) }
      else setError(i18n.t("尚未提交应用申请；请核对当前证据和浏览器会话存储后重试。"))
    } }
    finally { if (current(id)) { inFlight.current = false; setLoading(false) } }
  }

  return <section aria-label={i18n.t("配置保存与应用证据")} className="space-y-3 rounded-md border p-3 text-sm">
    <p>{i18n.t("已读取文件版本：")}<code className="break-all">{revision ?? i18n.t("未知")}</code></p>
    {dirty ? <p className="text-amber-700">{i18n.t("有未保存草稿；基于版本 ")}{draftRevision?.slice(0, 12) ?? i18n.t("未知")}{i18n.t("。保存前不会应用草稿。")}</p> : null}
    {managed ? <>
      <p className="text-xs text-muted-foreground">{i18n.t("文件已保存、当前代配置语义一致、平台就绪和业务验证是不同证据；未确认应用不等于应用失败。")}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void read()} disabled={loading || disabled || !revision}>{loading ? i18n.t("正在核对…") : i18n.t("读取应用证据")}</Button>
        <Button size="sm" onClick={() => void apply()} disabled={!bound || !canApplyPlugin(evidence) || dirty || disabled || loading || unconfirmed}>{i18n.t("应用已保存配置")}</Button>
        <Button size="sm" variant="outline" asChild><Link to="/logs">{i18n.t("查看运行日志")}</Link></Button></div>
      {evidence ? <><p className="break-all text-xs text-muted-foreground">{i18n.t("证据文件版本：")}{evidence.revision ?? i18n.t("未知")}</p>{!bound ? <p role="status">{i18n.t("证据与已读取文件版本不一致，或该实例未声明；请刷新文件并核对草稿后重新读取，当前不会申请应用。")}</p> : null}<PluginManagementSummary state={evidence} showNavigation={!dirty} /></> : null}
    </> : <p className="text-xs text-muted-foreground">{i18n.t("此项不是已声明的插件实例；文件保存不证明 Host 或应用配置已生效，请按实际保存回执处理进程重启。")}</p>}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {ConfirmDialog}
  </section>
}
