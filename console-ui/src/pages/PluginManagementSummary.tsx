import { useI18n } from '../i18n'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { managementLabel, type PluginManagementState } from './plugin-management-model.mjs'

export function PluginManagementSummary({ state, error, readOnly = false, showNavigation = true }: { readOnly?: boolean; showNavigation?: boolean; state?: PluginManagementState | null; error?: string | null }) {
  const i18n = useI18n()
  if (!state) return <p className="text-sm text-muted-foreground">{error ? i18n.t("状态未确认：{0}", [error]) : i18n.t("Host 未提供安装与当前代证据，请刷新状态。")}</p>
  const failures = [...state.issues, ...(state.validation?.errors.map(issue => `${issue.path} ${issue.message}`) ?? [])]
  return <section aria-label={i18n.t("插件应用证据")} className="space-y-3 text-sm">
    <div className="flex flex-wrap gap-2"><Badge variant={state.status === 'enabled' ? 'success' : state.status === 'degraded' || state.status === 'missing-config' ? 'warning' : 'secondary'}>{managementLabel(state, i18n.locale)}</Badge>{state.disabled && <Badge variant="secondary">{i18n.t("已设为停用")}</Badge>}<span className="text-muted-foreground">{i18n.t("当前代：")}{state.generation ?? i18n.t("未发布")}</span></div>
    <div className="grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground"><span>{i18n.t("依赖包：")}{state.installed ? i18n.t("已安装 {0}", [state.version ?? i18n.t("版本未知")]) : i18n.t("未安装")}</span><span>{i18n.t("实例声明：")}{state.declared ? i18n.t("已保存") : i18n.t("未保存")}</span><span>{i18n.t("当前代：")}{state.published ? i18n.t("包与配置一致") : i18n.t("尚未确认应用")}</span><span>{i18n.t("依赖检查：")}{{passed:i18n.t("通过"),failed:i18n.t("失败"),unchecked:i18n.t("尚未检查")}[state.dependencies]}</span><span>{i18n.t("就绪证据：")}{{ready:i18n.t("已就绪"),pending:i18n.t("等待就绪"),degraded:i18n.t("降级"),unknown:i18n.t("未知（未确认平台上线）")}[state.readiness]}</span><span>{i18n.t("业务验证：")}{state.verification === 'available' ? i18n.t("可手动选择检查") : i18n.t("未提供检查")}</span></div>
    {state.validation?.schemaAvailable === false && <p className="text-xs text-muted-foreground">{i18n.t("尚无可读取 schema，仅已检查环境引用；完整校验需 Runtime 预检。")}</p>}
    {!!state.validation?.missingEnv.length && <p className="text-amber-700">{i18n.t("缺少环境变量：")}{state.validation.missingEnv.join('、')}</p>}
    {failures.length > 0 && <ul className="list-disc pl-5 text-destructive">{failures.map((issue,index) => <li key={index}>{issue}</li>)}</ul>}
    <p className="text-xs text-muted-foreground">{i18n.t("安装、应用与平台就绪不代表业务功能已经验证。")}</p>
    {state.declared && showNavigation && <div className="flex gap-2"><Button variant="outline" size="sm" asChild><Link to={`/plugins/${encodeURIComponent(state.instanceKey)}`}>{i18n.t("插件详情")}</Link></Button><Button variant="outline" size="sm" asChild><Link to={`/config?plugin=${encodeURIComponent(state.instanceKey)}`}>{readOnly ? i18n.t("查看配置") : i18n.t("配置此实例")}</Link></Button></div>}
  </section>
}
