import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Cable, RefreshCw, Settings2, SlidersHorizontal, XCircle, Zap } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { adapterHref, endpointHref } from '../../console-routes.mjs'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission, scopePermissionTarget } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { endpointLifecycleLabel } from '../endpoint-presentation.mjs'
import { endpointTestError, endpointTestPresentation, readEndpointTestResult, type EndpointTestResult } from '../endpoint-test-result-model.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import type { Scope } from '../../scope/scope-tree.mjs'
import { ObjectFacts } from './scope-panels'
import { endpointAccessState, loginTasksFor, platformLabel } from './scope-overview-model.mjs'
import { type EndpointsAndLogin, type ScopeEndpoint } from './login-tasks'
import { LoginFlowSection } from './login-flow-card'
import './scope-pages.css'

/** `endpoint.test` for one account; the result is announced (status / alert) next to the button. */
function ConnectionTest({ endpoint }: { endpoint: ScopeEndpoint }) {
  const i18n = useI18n()
  const [state, setState] = useState<{ loading: boolean; result?: EndpointTestResult }>({ loading: false })
  const run = async () => {
    setState({ loading: true })
    try {
      const reply = await requestConsole<unknown>({ type: (ENDPOINT_RPC as { TEST?: string }).TEST ?? 'endpoint.test', adapter: endpoint.adapter, endpointKey: endpoint.name })
      setState({ loading: false, result: readEndpointTestResult(reply) })
    } catch (error) {
      setState({ loading: false, result: endpointTestError(i18n.t('测试失败：{0}', [error instanceof Error ? error.message : String(error)])) })
    }
  }
  const presentation = state.result ? endpointTestPresentation(state.result, i18n.locale) : null
  return (
    <div className="console-scope-test">
      <Button variant="outline" size="sm" disabled={state.loading} onClick={() => void run()}>
        <Zap className={state.loading ? 'animate-pulse' : ''} />{state.loading ? i18n.t('测试中…') : i18n.t('测试连接')}
      </Button>
      {presentation && !state.loading ? (
        <span role={presentation.role} className={presentation.tone === 'success' ? 'console-scope-test-result is-ok' : 'console-scope-test-result is-error'}>
          {presentation.tone === 'success' ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
          <span className="font-medium">{presentation.label}</span>
          {presentation.detail ? <span className="text-muted-foreground">{presentation.detail}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 接入 tab of one account: its connection (state + test), open login tasks (QR code, slider, SMS)
 * and where its configuration lives. An account the Host does not list right now gets its own
 * explanation instead of an empty account list.
 */
export function EndpointAccessPanel({ scope, data }: { scope: Scope; data: EndpointsAndLogin }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const adapter = scope.adapter!
  const name = scope.endpoint!
  const state = endpointAccessState(data, adapter, name)
  const tasks = loginTasksFor(data.tasks, adapter, name)
  // An adapter / account-scoped operator may answer this account's login (ADR 0058 §8).
  const canOperate = hasConsolePermission('endpoint.operate', access, scopePermissionTarget(scope))
  const canManage = hasConsolePermission('endpoint.manage', access)
  const refresh = <Button variant="outline" size="sm" onClick={data.refresh} disabled={data.loading}><RefreshCw className={data.loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>
  const configSection = (
    <ObjectSection title={i18n.t('配置')} description={i18n.t('账号的连接参数（Token、地址、登录方式）在适配器的连接管理里修改；按账号的功能设置在「功能」页签。')}>
      <Card className="console-scope-links p-4">
        <Link to={adapterHref(adapter)} className="console-scope-link-card">
          <Cable aria-hidden="true" />
          <span><span className="font-medium">{i18n.t('连接管理')}</span><span className="console-scope-row-sub">{canManage ? i18n.t('在适配器 {0} 页面编辑、停用或移除这个账号', [adapter]) : i18n.t('需要 endpoint.manage 权限才能修改')}</span></span>
        </Link>
        <Link to={endpointHref(adapter, name, 'features')} className="console-scope-link-card">
          <SlidersHorizontal aria-hidden="true" />
          <span><span className="font-medium">{i18n.t('功能')}</span><span className="console-scope-row-sub">{i18n.t('这个账号的功能开关与覆盖')}</span></span>
        </Link>
        <Link to="/ops/config" className="console-scope-link-card">
          <Settings2 aria-hidden="true" />
          <span><span className="font-medium">{i18n.t('配置文件')}</span><span className="console-scope-row-sub">{i18n.t('直接查看或编辑项目配置')}</span></span>
        </Link>
      </Card>
    </ObjectSection>
  )
  if (state.kind === 'loading') return <StatusState kind="loading" placeholder={<div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-32" /></div>} />
  if (state.kind === 'failed') return <StatusState error={state.error} onRetry={data.refresh} />
  if (state.kind === 'unlisted') {
    return (
      <>
        <StatusState kind="empty" title={i18n.t('账号 {0} 当前没有运行', [name])}
          description={state.siblings
            ? i18n.t('Host 正在运行适配器 {0} 的其他账号，但列表里没有这个账号。它可能已从配置中移除、被停用，或还没有启动。', [adapter])
            : i18n.t('Host 当前没有运行适配器 {0} 的任何账号。请检查适配器插件是否启用、账号配置是否完整。', [adapter])}
          actions={<>
            <Button asChild size="sm" variant="outline"><Link to={adapterHref(adapter)}><Cable />{i18n.t('打开适配器')}</Link></Button>
            <Button size="sm" variant="outline" onClick={data.refresh}><RefreshCw />{i18n.t('重新读取')}</Button>
          </>} />
        {configSection}
      </>
    )
  }
  const endpoint = state.endpoint
  const pending = (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
  return (
    <>
      <ObjectSection title={i18n.t('连接')} description={i18n.t('账号与平台之间的连接状态。测试连接只读取状态，不会发送消息。')} actions={refresh}>
        <ObjectFacts items={[
          { label: i18n.t('连接'), value: <Badge variant={endpoint.connected ? 'success' : 'outline'} size="sm">{endpoint.connected ? i18n.t('已连接') : i18n.t('未连接')}</Badge> },
          { label: i18n.t('运行状态'), value: i18n.t(endpointLifecycleLabel(endpoint)) },
          { label: i18n.t('平台'), value: i18n.t(platformLabel(endpoint.adapter)) },
          ...(endpoint.transportState ? [{ label: i18n.t('传输'), value: <code className="text-sm">{endpoint.transportState}</code> }] : []),
          { label: i18n.t('待处理事件'), value: pending },
        ]} />
        <ConnectionTest endpoint={endpoint} />
      </ObjectSection>
      <ObjectSection title={i18n.t('登录')} description={i18n.t('扫码、短信、滑块、设备锁和身份验证按步骤显示在这里，结果实时更新。完成后账号自动上线。')}>
        <LoginFlowSection endpoint={endpoint} legacyTasks={tasks} canOperate={canOperate} onSettled={data.refresh} />
      </ObjectSection>
      {configSection}
    </>
  )
}
