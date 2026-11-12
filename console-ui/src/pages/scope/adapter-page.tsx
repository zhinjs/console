import { Link } from 'react-router-dom'
import { Cable, MessageSquare, RefreshCw, SlidersHorizontal, UserRound } from 'lucide-react'
import { AdapterConsolePage } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { endpointHref } from '../../console-routes.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { endpointsOfAdapter } from '../features/feature-model.mjs'
import { useEndpointList, useFeatureMatrix } from '../features/use-feature-data'
import { ObjectPageLayout, ObjectSection } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import type { Scope } from '../../scope/scope-tree.mjs'
import { ScopeFeaturesPanel, ScopeRecordsPanel } from './scope-panels'

/** `/scope/:adapter` — 适配器: its accounts and connections (概览), overrides (功能), roles, records. */
export function AdapterObjectPage({ scope }: { scope: Scope & { level: 'adapter' } }) {
  const i18n = useI18n()
  const list = useEndpointList()
  const accounts = endpointsOfAdapter(list.endpoints, scope.adapter!)
  const online = accounts.filter(account => account.connected).length
  return (
    <ObjectPageLayout
      scope={scope}
      title={scope.adapter!}
      description={i18n.t('该适配器下的账号、连接与功能覆盖。')}
      icon={Cable}
      status={list.loaded ? <Badge variant={accounts.length && online === accounts.length ? 'success' : online ? 'warning' : 'outline'}>{i18n.t('{0} / {1} 在线', [online, accounts.length])}</Badge> : null}
      actions={<Button variant="outline" size="sm" onClick={list.refresh} disabled={list.loading}><RefreshCw className={list.loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}
      badges={{ overview: list.loaded ? accounts.length : undefined }}
      panels={{
        overview: <AdapterOverview scope={scope} list={list} />,
        features: <ScopeFeaturesPanel scope={scope} />,
        roles: <ChatRolesPanel scope={scope} />,
        records: <ScopeRecordsPanel scope={scope} />,
      }}
    />
  )
}

function AdapterOverview({ scope, list }: { scope: Scope; list: ReturnType<typeof useEndpointList> }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const adapter = scope.adapter!
  const accounts = endpointsOfAdapter(list.endpoints, adapter)
  const matrix = useFeatureMatrix()
  // Endpoint ids the Host knows for this alias from configuration and stored overrides.
  const knownEndpoints = (matrix.endpoints[adapter] ?? []).filter(id => !accounts.some(account => account.name === id))
  return (
    <>
      <ObjectSection title={i18n.t('账号')} description={i18n.t('点账号进入它的对象页：接入、聊天、功能与角色。')}>
        {list.error && !list.loaded ? <StatusState error={list.error} onRetry={list.refresh} /> : null}
        <Card className="overflow-hidden p-0">
          {list.loading && !list.loaded ? (
            <div className="space-y-2 p-4">{[0, 1].map(index => <Skeleton key={index} className="h-9" />)}</div>
          ) : !accounts.length ? (
            <StatusState kind="empty" compact className="m-3" title={i18n.t('这个适配器还没有账号')} description={list.loaded ? i18n.t('在下方的连接管理里添加账号。') : undefined} />
          ) : (
            <Table aria-label={i18n.t('账号')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t('账号')}</TableHead>
                  <TableHead>{i18n.t('状态')}</TableHead>
                  <TableHead className="text-right">{i18n.t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(account => (
                  <TableRow key={account.name}>
                    <TableCell>
                      <Link to={endpointHref(adapter, account.name)} className="inline-flex items-center gap-2 font-medium hover:underline">
                        <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{account.name}
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant={account.connected ? 'success' : 'outline'}>{account.connected ? i18n.t('在线') : i18n.t('离线')}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        <Button asChild variant="outline" size="sm"><Link to={endpointHref(adapter, account.name, 'chat')}><MessageSquare />{i18n.t('聊天')}</Link></Button>
                        <Button asChild variant="outline" size="sm"><Link to={endpointHref(adapter, account.name, 'features')}><SlidersHorizontal />{i18n.t('功能')}</Link></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {knownEndpoints.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{i18n.t('配置中的其他账号：')}</span>
            {knownEndpoints.map(id => (
              <Button key={id} asChild variant="outline" size="sm"><Link to={endpointHref(adapter, id)}><UserRound />{id}</Link></Button>
            ))}
          </div>
        ) : null}
      </ObjectSection>
      <ObjectSection title={i18n.t('连接管理')}>
        {hasConsolePermission('endpoint.manage', access)
          ? <AdapterConsolePage adapterKey={adapter} />
          : <StatusState kind="forbidden" permissions={['endpoint.manage']} description={i18n.t('当前身份不能管理账号连接。')} />}
      </ObjectSection>
    </>
  )
}
