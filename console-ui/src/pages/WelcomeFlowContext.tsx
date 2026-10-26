import { useI18n } from '../i18n'
import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import { apiFetch } from '../utils/auth'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { readWelcomeInstances, readWelcomeUseCase, welcomeDetailUrl, welcomeReturnUrl } from './welcome-use-case-model.mjs'

/** Contextual navigation only; the original form and detail page retain all mutation ownership. */
export function WelcomeFlowContext({ instanceKey, kind }: { instanceKey: string; kind: 'config' | 'detail' }) {
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return null
  return <WelcomeFlowContextSession key={JSON.stringify([scope, instanceKey])} instanceKey={instanceKey} kind={kind} scope={scope} />
}
function WelcomeFlowContextSession({ instanceKey, kind, scope }: { instanceKey: string; kind: 'config' | 'detail'; scope: string }) {
  const i18n = useI18n()
  const [matched, setMatched] = useState(false), [error, setError] = useState<string | null>(null)
  const gate = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  useEffect(() => {
    const read = gate.current.begin()
    void (async () => {
      try {
        const [catalog, plugins] = await Promise.all([apiFetch(CONSOLE_REST.TASK_USE_CASES, { signal: read.signal, cache: 'no-store' }), apiFetch('/api/plugins', { signal: read.signal, cache: 'no-store' })])
        if (!catalog.ok || !plugins.ok) throw Error(i18n.t("群欢迎用途上下文读取失败，请返回用途页重新核对。"))
        const useCase = readWelcomeUseCase(await catalog.json(), i18n.locale)
        const matches = readWelcomeInstances(await plugins.json(), useCase.packageName, i18n.locale).some(item => item.instanceKey === instanceKey)
        if (read.current()) setMatched(matches)
      } catch (cause) { if (read.current()) setError(cause instanceof Error ? cause.message : i18n.t("用途读取失败")) }
    })()
    return () => gate.current.cancel()
  }, [instanceKey, scope])
  if (!isInboxCacheScopeActive(scope)) return null
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!matched) return null
  return <Card><CardContent className="space-y-3 p-4 text-sm"><p className="font-medium">{i18n.t("群欢迎 · 当前实例 ")}{instanceKey}</p>
    {kind === 'config' ? <><p>{i18n.t("本用途关注 welcomeMessage 与 welcomeConversations。建议先明确设为空范围，再选择精确群。只修改你需要的草稿，其他字段仍由原表单完整保留。")}</p><p>{i18n.t("省略范围会覆盖所有符合条件的群；空列表关闭全部欢迎。保存后仍需在详情核对应用，不能将草稿当成生效配置。")}</p></> : <p>{i18n.t("继续使用下方原有“应用变更”与状态核对。完成后返回用途页，选择完整测试群进行真实成员加入的人工核验；应用不等于平台业务验证。")}</p>}
    <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={welcomeReturnUrl(instanceKey)}>{i18n.t("返回群欢迎流程")}</Link></Button>{kind === 'config' && <Button asChild variant="outline"><Link to={welcomeDetailUrl(instanceKey)}>{i18n.t("保存后到详情核对应用")}</Link></Button>}</div>
  </CardContent></Card>
}
