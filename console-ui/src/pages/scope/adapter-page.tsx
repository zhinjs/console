import { useState } from 'react'
import { BookOpen, Cable, Plus, RefreshCw, X } from 'lucide-react'
import { AdapterConsolePage, type AdapterConsoleToolbarControls } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { StatusState } from '../../components/StatusState'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { ObjectPageLayout, ObjectSection } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import type { Scope } from '../../scope/scope-tree.mjs'
import { AdapterOverview } from './overview-panels'
import { useEndpointsAndLogin } from './login-tasks'
import { platformLabel } from './scope-overview-model.mjs'
import { ScopeFeaturesPanel, ScopeRecordsPanel } from './scope-panels'

/** `/scope/:adapter` — 适配器: its accounts and connection management (概览), overrides (功能), roles, records. */
export function AdapterObjectPage({ scope }: { scope: Scope & { level: 'adapter' } }) {
  const i18n = useI18n()
  const data = useEndpointsAndLogin()
  const accounts = data.endpoints.filter(endpoint => endpoint.adapter === scope.adapter)
  const online = accounts.filter(account => account.connected).length
  const platform = platformLabel(scope.adapter!)
  // One 刷新 for the whole page: the header re-reads accounts and the embedded connection management too.
  const [managementRefresh, setManagementRefresh] = useState(0)
  const refresh = () => { data.refresh(); setManagementRefresh(value => value + 1) }
  return (
    <ObjectPageLayout
      scope={scope}
      title={scope.adapter!}
      description={i18n.t('该适配器下的账号、连接与功能覆盖。')}
      icon={Cable}
      platform={platform !== scope.adapter ? i18n.t(platform) : undefined}
      status={data.loaded ? <Badge variant={accounts.length && online === accounts.length ? 'success' : online ? 'warning' : 'outline'}>{i18n.t('{0} / {1} 在线', [online, accounts.length])}</Badge> : null}
      actions={<Button variant="outline" size="sm" onClick={refresh} disabled={data.loading}><RefreshCw className={data.loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}
      panels={{
        overview: <AdapterOverview scope={scope} data={data} management={<ConnectionManagement adapter={scope.adapter!} refreshKey={managementRefresh} />} />,
        features: <ScopeFeaturesPanel scope={scope} />,
        roles: <ChatRolesPanel scope={scope} />,
        records: <ScopeRecordsPanel scope={scope} />,
      }}
    />
  )
}

/**
 * The adapter plugin's own account management (SDK page, `@zhin.js/client` embedded mode), framed like
 * any other section: no SDK page header; title and 刷新 belong to the object page, and 文档 / 添加
 * render with the Console's buttons through `toolbar`.
 */
function ConnectionManagement({ adapter, refreshKey }: { adapter: string; refreshKey: number }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const toolbar = ({ docsUrl, add }: AdapterConsoleToolbarControls) => (docsUrl || add) ? (
    <div className="console-adapter-console-toolbar">
      {docsUrl ? <Button asChild variant="outline" size="sm"><a href={docsUrl} target="_blank" rel="noreferrer"><BookOpen />{i18n.t('文档')}</a></Button> : null}
      {add ? (
        <Button size="sm" variant={add.open ? 'outline' : 'default'} disabled={add.disabled} aria-expanded={add.open} aria-controls={add.controls} onClick={add.toggle}>
          {add.open ? <X /> : <Plus />}{add.open ? i18n.t('取消') : i18n.t('添加账号')}
        </Button>
      ) : null}
    </div>
  ) : null
  return (
    <ObjectSection className="console-connection-manager" title={i18n.t('连接管理')} description={i18n.t('由适配器插件提供：添加、编辑、启停账号与登录方式。')}>
      {hasConsolePermission('endpoint.manage', access) ? (
        <Card className="console-adapter-console p-4">
          <AdapterConsolePage adapterKey={adapter} embedded refreshKey={refreshKey} toolbar={toolbar} />
        </Card>
      ) : <StatusState kind="forbidden" permissions={['endpoint.manage']} description={i18n.t('当前身份不能管理账号连接。')} />}
    </ObjectSection>
  )
}
