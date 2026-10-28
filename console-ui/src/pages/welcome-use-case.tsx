import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { SelectField } from '../components/ui/select'
import { Alert, AlertDescription } from '../components/ui/alert'
import { ConversationTargetEditor, ConversationTargetSummary } from '../components/PluginConfigForm/ConversationTargetEditor'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { apiFetch } from '../utils/auth'
import { isDemoMode } from '../utils/demo-mode'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { readWelcomeUseCase, readWelcomeInstances, welcomeConfigUrl, welcomeDetailUrl, welcomeEvidenceKey, welcomeApplied, welcomeReady, welcomeReturnUrl, welcomeTargetKey, type WelcomeInstance } from './welcome-use-case-model.mjs'
import type { TaskUseCase } from './task-center-model.mjs'
import { useWelcomeInspection } from './useWelcomeInspection'

export default function WelcomeUseCasePage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope) || isDemoMode()) return <Alert><AlertDescription>{i18n.t("请连接具有管理权限的 Host 后配置群欢迎。Demo 不读取或修改此配置。")}</AlertDescription></Alert>
  return <WelcomeUseCaseSession key={scope} scope={scope} />
}

export function WelcomeUseCaseSession({ scope }: { scope: string }) {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams(), instanceKey = params.get('instance') ?? ''
  const [catalog, setCatalog] = useState<{ useCase: TaskUseCase; instances: WelcomeInstance[] } | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const reads = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [target, setTarget] = useState<unknown>({ kind: 'group' }), [observed, setObserved] = useState(false), [confirmError, setConfirmError] = useState<string | null>(null)
  const selected = catalog?.instances.find(item => item.instanceKey === instanceKey)
  const inspection = useWelcomeInspection(selected?.instanceKey ?? '', catalog?.useCase.packageName ?? '', target)
  const load = async () => {
    const read = reads.current.begin()
    if (!read.current() || !isInboxCacheScopeActive(scope)) return
    setLoading(true); setCatalog(null); setCatalogError(null)
    try {
      const [useCasesResponse, instancesResponse] = await Promise.all([apiFetch(CONSOLE_REST.TASK_USE_CASES, { signal: read.signal, cache: 'no-store' }), apiFetch('/api/plugins', { signal: read.signal, cache: 'no-store' })])
      if (!useCasesResponse.ok || !instancesResponse.ok) throw Error(i18n.t("无法读取 Host 用途与实例目录，请核对连接和管理权限后刷新。"))
      const useCase = readWelcomeUseCase(await useCasesResponse.json(), i18n.locale)
      const instances = readWelcomeInstances(await instancesResponse.json(), useCase.packageName, i18n.locale)
      if (read.current() && isInboxCacheScopeActive(scope)) setCatalog({ useCase, instances })
    } catch (cause) { if (read.current() && isInboxCacheScopeActive(scope)) setCatalogError(cause instanceof Error ? cause.message : i18n.t("目录读取失败")) }
    finally { if (read.current() && isInboxCacheScopeActive(scope)) setLoading(false) }
  }
  useEffect(() => { void load(); return () => reads.current.cancel() }, [scope])
  const binding = JSON.stringify([instanceKey, welcomeEvidenceKey(inspection.evidence), welcomeTargetKey(target)])
  useEffect(() => { setObserved(false); setConfirmError(null) }, [binding])
  const active = isInboxCacheScopeActive(scope), applied = welcomeApplied(inspection.evidence)
  const ready = active && selected && welcomeReady(inspection.evidence, target)
  return <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">{i18n.t("配置新成员欢迎")}</h1><p className="mt-1 text-sm text-muted-foreground">{i18n.t("选择实例、限定范围、核对应用，再到真实群完成人工验证。")}</p></div><Button asChild variant="outline"><Link to="/tasks">{i18n.t("返回用途目录")}</Link></Button></div>
    {catalogError && <Alert variant="destructive"><AlertDescription>{catalogError}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>{i18n.t("1 · 选择明确实例")}</CardTitle></CardHeader><CardContent className="space-y-3">
      <Button variant="outline" disabled={loading || !active} onClick={() => void load()}>{loading ? i18n.t("读取中…") : i18n.t("刷新用途与实例")}</Button>
      {catalog && <><p className="break-all text-sm">{i18n.t("Host 用途指定的插件包：")}<code>{catalog.useCase.packageName}</code></p>
        <label className="block text-sm">{i18n.t("群欢迎实例")}<SelectField aria-label={i18n.t("群欢迎实例")} className="mt-2 w-full min-w-0" value={selected ? instanceKey : ''} onValueChange={value => { setObserved(false); setTarget({ kind: 'group' }); setParams(value ? { instance: value } : {}) }} options={[{ value: '', label: i18n.t("请选择实例（不会默认选择同包实例）") }, ...catalog.instances.map(item => ({ value: item.instanceKey, label: <>{item.instanceKey} · {item.status === 'active' ? i18n.t("已加载") : i18n.t("未加载")}</> }))]} /></label>
        {!catalog.instances.length && <p className="text-sm">{i18n.t("尚无该包的可管理实例，请先审阅安装计划。")}</p>}
        {instanceKey && !selected && <p role="alert" className="text-sm text-destructive">{i18n.t("返回的实例不在当前 Host 的可管理目录中，请刷新或重新选择，不按包名猜测。")}</p>}
        <Button asChild variant="outline"><Link to="/marketplace?useCase=group-welcome">{i18n.t("查看此用途的插件与安装计划")}</Link></Button></>}
    </CardContent></Card>
    {selected && <><Card><CardHeader><CardTitle>{i18n.t("2 · 在原配置表单选择范围")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{i18n.t("当前实例：")}<strong className="break-all">{selected.instanceKey}</strong>{i18n.t("。填写 welcomeMessage；建议先明确设为空范围，再添加希望欢迎的群。这里只提供引导，不自动修改任何值。")}</p><p>{i18n.t("省略 welcomeConversations 表示所有符合条件的群；空列表表示全部关闭。账号、父容器和话题都参与精确匹配，其他实例不受本次配置限制。")}</p><Button asChild><Link to={welcomeConfigUrl(selected.instanceKey)}>{i18n.t("打开此实例原配置表单")}</Link></Button></CardContent></Card>
      <Card><CardHeader><CardTitle>{i18n.t("3 · 核对保存与当前运行代")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{i18n.t("保存只确认文件版本。应用继续使用插件详情的原有确认与状态核对；本页不会申请重启或重复保存。")}</p><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={welcomeDetailUrl(selected.instanceKey)}>{i18n.t("打开详情并核对应用")}</Link></Button><Button variant="outline" disabled={inspection.loading || !active} onClick={() => void inspection.refresh()}>{i18n.t("重新读取应用证据")}</Button></div>
        {inspection.error && <Alert variant="destructive"><AlertDescription>{i18n.t("证据读取失败，不能沿用旧确认。")}{inspection.error}</AlertDescription></Alert>}
        {inspection.loading ? <p role="status">{i18n.t("正在只读核对当前实例与运行代…")}</p> : inspection.evidence ? <><p>{applied ? i18n.t("当前代配置语义已匹配；业务尚未由机器验证。") : i18n.t("当前实例尚未满足已应用条件，请在详情处理后重新核对。")}</p><p>{i18n.t("欢迎文案：")}{inspection.evidence.welcome.messagePresent === null ? i18n.t("含环境引用，当前证据无法确认展开后是否非空") : inspection.evidence.welcome.messagePresent ? i18n.t("已填写（不在此页展示正文）") : i18n.t("空文案，欢迎已关闭")}{i18n.t("。范围：")}{inspection.evidence.welcome.mode === 'unknown' ? i18n.t("含环境引用，展开范围未读取，不能由文件判断实际会话") : inspection.evidence.welcome.mode === 'all' ? i18n.t("全部符合事件条件的群") : inspection.evidence.welcome.mode === 'none' ? i18n.t("空列表，不欢迎任何群") : i18n.t("仅 {0} 个精确会话", [inspection.evidence.welcome.targets.length])}。</p>{inspection.evidence.welcome.targets.length > 0 && <details><summary className="cursor-pointer">{i18n.t("查看当前文件的精确范围（非草稿）")}</summary><div className="mt-2 space-y-2">{inspection.evidence.welcome.targets.map((item, index) => <ConversationTargetSummary key={index} value={item} />)}</div></details>}<dl className="space-y-1 break-all text-xs text-muted-foreground"><div>{i18n.t("文件 revision：")}{inspection.evidence.state.revision ?? i18n.t("未知")}</div><div>{i18n.t("项目 revision：")}{inspection.evidence.state.projectRevision}</div><div>{i18n.t("运行代：")}{inspection.evidence.state.generation ?? i18n.t("尚未发布")}</div></dl></> : null}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{i18n.t("4 · 在测试群人工核对")}</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><p>{i18n.t("选择实际测试群，由成员真实加入后核对该实例的欢迎。此操作可能向群发消息，请先与群成员约定。普通测试发送不能代替成员加入链路。")}</p>
        <ConversationTargetEditor value={target} onChange={next => { setObserved(false); setConfirmError(null); setTarget(next) }} allowedKinds={['group']} disabled={!active} idPrefix="welcome-test" />
        {!ready && inspection.evidence && <p className="text-muted-foreground">{i18n.t("尚不能记录：请核对已应用状态、非空欢迎文案、非空范围，以及测试群完整身份是否在精确范围中。")}</p>}
        <label className="flex items-start gap-2"><Checkbox className="mt-1" checked={observed} onCheckedChange={checked => setObserved(checked === true)} disabled={!ready || !welcomeTargetKey(target)} /><span>{i18n.t("我已在上述完整会话观察真实成员加入，并核对该实例按预期欢迎。此为人工观察与归因，系统未自动识别发出欢迎的实例。")}</span></label>
        <Button disabled={!active || !ready || !observed || !welcomeTargetKey(target) || inspection.loading} onClick={async () => { if (!observed || !isInboxCacheScopeActive(scope)) return; const confirmed = await inspection.confirmObserved(); if (isInboxCacheScopeActive(scope)) { setObserved(false); setConfirmError(confirmed ? null : i18n.t("证据或目标已变化，未记录确认；请重新核对当前状态与实际群结果。")) } }}>{i18n.t("只读核对后记录人工确认")}</Button>
        {confirmError && <p role="alert" className="text-destructive">{confirmError}</p>}
        {inspection.manualRecord && <Alert><AlertDescription>{i18n.t("人工确认 · ")}{new Date(inspection.manualRecord.at).toLocaleString(i18n.locale)}{i18n.t("。这是当时的人工观察记录，不是平台自动验收，也不保证持续可用。配置、实例、运行代、完整测试目标或连接身份变化后失效；重读失败不保留确认。")}</AlertDescription></Alert>}
        <p className="text-xs text-muted-foreground">{i18n.t("记录仅保留在本页内存，离开或刷新页面后丢失。后台每 10 秒只读核对；核对存在间隔，不承诺实时有效。投递结果不确定时先看原群与日志，不自动重发。")}</p>
        <div className="flex flex-wrap gap-3"><Link className="underline" to="/endpoints">{i18n.t("到账号与会话核对")}</Link><Link className="underline" to={`/logs?q=${encodeURIComponent(selected.instanceKey)}`}>{i18n.t("查看相关日志")}</Link><Link className="underline" to={welcomeReturnUrl()}>{i18n.t("重新开始本用途")}</Link></div>
      </CardContent></Card></>}
  </div>
}
