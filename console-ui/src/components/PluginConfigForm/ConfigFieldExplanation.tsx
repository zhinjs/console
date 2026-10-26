import { useI18n } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { requestConsole } from '../../utils/console-rpc'
import { CONSOLE_RPC } from '../../contracts/zhin-console'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isDemoMode } from '../../utils/demo-mode'
import { createConfigExplanationReader, explanationBindingKey, CONFIG_CANDIDATE_ORIGINS, CONFIG_GENERATION_MATCHES, CONFIG_EXPLANATION_REASONS, type ConfigExplanation, type ExplanationState } from './config-explanation-model.mjs'

type Props = { instanceKey: string; revision?: string; draftRevision?: string; dirty: boolean; disabled?: boolean; onOpenSource?: () => void }
export function ConfigFieldExplanation(props: Props) {
  const scope = useInboxCacheScope()
  if (isDemoMode() || !scope || !isInboxCacheScopeActive(scope)) return null
  return <ExplanationSession key={JSON.stringify([scope, props.instanceKey])} {...props} scope={scope} />
}
function ExplanationSession({ instanceKey, revision, draftRevision, dirty, disabled, onOpenSource, scope }: Props & { scope: string }) {
  const i18n = useI18n()
  const [state, setState] = useState<ExplanationState>({ kind: 'idle', key: null })
  const binding = { scope, instanceKey, revision: revision ?? '', disabled }
  const latest = useRef(binding); latest.current = binding
  const reader = useRef<ReturnType<typeof createConfigExplanationReader> | null>(null)
  if (!reader.current) reader.current = createConfigExplanationReader({
    read: selected => requestConsole({ type: CONSOLE_RPC.CONFIG_EXPLAIN, instanceKey: selected.instanceKey, expectedRevision: selected.revision }),
    getBinding: () => latest.current,
    active: selectedScope => getInboxCacheScope() === selectedScope && isInboxCacheScopeActive(selectedScope),
    publish: setState,
  }, i18n.locale)
  const key = explanationBindingKey(binding)
  const visible = !disabled && state.key === key && isInboxCacheScopeActive(scope) ? state : null
  useEffect(() => { reader.current?.cancel(); setState({ kind: 'idle', key: null }); return () => reader.current?.cancel() }, [key, disabled])
  return <section aria-label={i18n.t("字段来源与运行代一致性")} className="space-y-3 rounded-md border p-3 text-sm">
    <h3 className="font-medium">{i18n.t("字段来源与运行代一致性")}</h3>
    <p className="text-xs text-muted-foreground">{i18n.t("只解释已保存版本，按需读取；不显示配置值或环境变量展开值，不改配置、不申请应用、不发送消息。")}</p>
    <p className="break-all text-xs text-muted-foreground">{i18n.t("已读取文件版本：")}{revision ?? i18n.t("未知")}</p>
    {dirty && <p className="text-amber-700">{i18n.t("有未保存草稿（基于 ")}{draftRevision?.slice(0, 12) ?? i18n.t("未知版本")}{i18n.t("）；下面解释当前已读取的保存版本，不解释或覆盖草稿。")}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!key || disabled || visible?.kind === 'loading'} onClick={() => void reader.current?.load()}>{visible?.kind === 'loading' ? i18n.t("正在读取解释…") : i18n.t("读取已保存版本解释")}</Button>{onOpenSource && <Button variant="outline" size="sm" onClick={onOpenSource}>{i18n.t("查看完整源码")}</Button>}</div>
    {visible?.kind === 'error' && <p role="alert">{visible.message}</p>}
    {visible?.kind === 'ready' && visible.data && <ConfigFieldExplanationView data={visible.data} />}
  </section>
}
export function ConfigFieldExplanationView({ data }: { data: ConfigExplanation }) {
  const i18n = useI18n()
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{i18n.t("读取时运行代：")}{data.generation ?? i18n.t("不可用")}{i18n.t("。这是一份读取时的证据，不持续跟踪后续热重载。")}</p>
    <p className="text-xs text-muted-foreground">{i18n.t("运行代字段来源：未知（未记录）。值一致不证明来自同一配置来源；敏感或环境引用未比较不等于一致。")}</p>
    {data.projection === 'unsupported' ? <p role="status">{i18n.t("暂不能解释：")}{i18n.t(CONFIG_EXPLANATION_REASONS[data.reason ?? '']) ?? i18n.t("Host 未提供可证明证据。")}{i18n.t("请使用完整源码并结合运行日志核对。")}</p>
      : !data.fields.length ? <p role="status">{i18n.t("此 Schema 没有可展示的静态字段；这不证明业务配置已生效。")}</p>
        : <div className="max-w-full overflow-auto"><table className="w-full min-w-0 border-collapse text-xs"><thead><tr><th className="border p-2 text-left">{i18n.t("字段路径")}</th><th className="border p-2 text-left">{i18n.t("已保存候选来源")}</th><th className="border p-2 text-left">{i18n.t("读取时与运行代比较")}</th></tr></thead><tbody>{data.fields.map(field => <tr key={JSON.stringify(field.path)}><td className="break-all border p-2">{field.path.map(part => JSON.stringify(part)).join(' → ')}</td><td className="border p-2">{i18n.t(CONFIG_CANDIDATE_ORIGINS[field.candidateOrigin])}</td><td className="border p-2">{i18n.t(CONFIG_GENERATION_MATCHES[field.generationMatch])}</td></tr>)}</tbody></table></div>}
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{i18n.t("证据版本")}</summary><p className="mt-2 break-all">{i18n.t("配置文件版本：")}{data.revision}</p><p className="break-all">{i18n.t("项目版本：")}{data.projectRevision}</p></details>
  </div>
}
