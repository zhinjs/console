import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { managementLabel, type PluginManagementState } from './plugin-management-model.mjs'

export function PluginManagementSummary({ state, error, readOnly = false }: { readOnly?: boolean; state?: PluginManagementState | null; error?: string | null }) {
  if (!state) return <p className="text-sm text-muted-foreground">{error ? `状态未确认：${error}` : 'Host 未提供安装与当前代证据，请刷新状态。'}</p>
  const failures = [...state.issues, ...(state.validation?.errors.map(issue => `${issue.path} ${issue.message}`) ?? [])]
  return <section aria-label="插件应用证据" className="space-y-3 text-sm">
    <div className="flex flex-wrap gap-2"><Badge variant={state.status === 'enabled' ? 'success' : state.status === 'degraded' || state.status === 'missing-config' ? 'warning' : 'secondary'}>{managementLabel(state)}</Badge>{state.disabled && <Badge variant="secondary">已设为停用</Badge>}<span className="text-muted-foreground">当前代：{state.generation ?? '未发布'}</span></div>
    <div className="grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground"><span>依赖包：{state.installed ? `已安装 ${state.version ?? '版本未知'}` : '未安装'}</span><span>实例声明：{state.declared ? '已保存' : '未保存'}</span><span>当前代：{state.published ? '包与配置一致' : '尚未确认应用'}</span><span>依赖检查：{{passed:'通过',failed:'失败',unchecked:'尚未检查'}[state.dependencies]}</span><span>就绪证据：{{ready:'已就绪',pending:'等待就绪',degraded:'降级',unknown:'未知（未确认平台上线）'}[state.readiness]}</span><span>业务验证：{state.verification === 'available' ? '可手动选择检查' : '未提供检查'}</span></div>
    {state.validation?.schemaAvailable === false && <p className="text-xs text-muted-foreground">尚无可读取 schema，仅已检查环境引用；完整校验需 Runtime 预检。</p>}
    {!!state.validation?.missingEnv.length && <p className="text-amber-700">缺少环境变量：{state.validation.missingEnv.join('、')}</p>}
    {failures.length > 0 && <ul className="list-disc pl-5 text-destructive">{failures.map((issue,index) => <li key={index}>{issue}</li>)}</ul>}
    <p className="text-xs text-muted-foreground">安装、应用与平台就绪不代表业务功能已经验证。</p>
    {state.declared && <div className="flex gap-2"><Button variant="outline" size="sm" asChild><Link to={`/plugins/${encodeURIComponent(state.instanceKey)}`}>插件详情</Link></Button><Button variant="outline" size="sm" asChild><Link to={`/config?plugin=${encodeURIComponent(state.instanceKey)}`}>{readOnly ? '查看配置' : '配置此实例'}</Link></Button></div>}
  </section>
}
