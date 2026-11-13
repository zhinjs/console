import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Cable, ChevronRight, KeyRound, MessageSquare, MessagesSquare, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { adapterHref, conversationHref, endpointHref } from '../../console-routes.mjs'
import { app } from '../../utils/console-client'
import { endpointLifecycleLabel } from '../endpoint-presentation.mjs'
import { ConversationKindBadge } from '../features/conversation-list'
import type { ConversationItem } from '../features/feature-model.mjs'
import { useConversationList, useFeatureList, useFeatureMatrix } from '../features/use-feature-data'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { scopeHref, scopeKey, type Scope } from '../../scope/scope-tree.mjs'
import { ObjectFacts, type useEndpointInfo } from './scope-panels'
import {
  ACCOUNT_FILTER_LABELS, ACCOUNT_FILTERS, ONBOARDING_PLATFORMS, accountCounts, onboardingTarget, accountStatus, adapterOverview, conversationHighlights, filterAccounts,
  loginTasksFor, overviewTotals, platformLabel, type AccountFilter,
} from './scope-overview-model.mjs'
import { WaitingLoginBadge, useEndpointsAndLogin, useLoginTaskTypeLabel, type EndpointsAndLogin, type ScopeEndpoint } from './login-tasks'
import './scope-pages.css'

function AccountStatusBadge({ endpoint, tasks }: { endpoint: ScopeEndpoint; tasks: EndpointsAndLogin['tasks'] }) {
  const i18n = useI18n()
  const status = accountStatus(endpoint, tasks)
  if (status === 'waiting') return <WaitingLoginBadge />
  return <Badge variant={status === 'online' ? 'success' : 'outline'} size="sm" className="whitespace-nowrap">{status === 'online' ? i18n.t('在线') : i18n.t('离线')}</Badge>
}

/** Scrolls a section of this page into view and focuses its first control (an empty list's next step). */
function revealSection(selector: string) {
  const section = document.querySelector<HTMLElement>(selector)
  if (!section) return
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  section.querySelector<HTMLElement>('a, button, input')?.focus({ preventScroll: true })
}

function TableSkeleton({ rows = 2 }: { rows?: number }) {
  return <StatusState kind="loading" className="m-4" placeholder={<div className="space-y-2 p-4">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-9" />)}</div>} />
}

/** 「接入新平台账号」: where each platform is set up. */
function OnboardingSection({ first }: { first: boolean }) {
  const i18n = useI18n()
  const routes = useSyncExternalStore(app.subscribe, () => app.getRoutes())
  const registered = useMemo(() => new Set(routes.map(route => route.path)), [routes])
  return (
    <ObjectSection className="console-connect-platforms" title={i18n.t('接入新平台账号')}
      description={first ? i18n.t('还没有聊天账号。选择平台，在它的适配器页面添加账号、填写 Token 或扫码登录。') : i18n.t('选择平台，在它的适配器页面添加账号、填写 Token 或扫码登录。')}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {ONBOARDING_PLATFORMS.map(platform => {
          const target = onboardingTarget(platform, registered)
          return (
          <Link key={platform.id} to={target.to} className="console-onboarding-card group">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{i18n.t(platform.title)}</span>
              <span className="console-platform-brand-badge max-sm:hidden">{i18n.t(platform.badge)}</span>
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground max-sm:hidden">{i18n.t(platform.desc)}</span>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">{target.install ? i18n.t('先安装适配器') : i18n.t('前往接入')}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
          </Link>
          )
        })}
      </div>
    </ObjectSection>
  )
}

/** Account table shared by 全局 and 适配器 overviews: the name links to the account page. */
function AccountTable({ endpoints, tasks, showAdapter, label }: { endpoints: readonly ScopeEndpoint[]; tasks: EndpointsAndLogin['tasks']; showAdapter: boolean; label: string }) {
  const i18n = useI18n()
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{i18n.t('账号')}</TableHead>
          {showAdapter ? <TableHead className="max-md:hidden">{i18n.t('适配器')}</TableHead> : null}
          <TableHead>{i18n.t('状态')}</TableHead>
          <TableHead className="max-md:hidden">{i18n.t('待处理')}</TableHead>
          <TableHead className="text-right">{i18n.t('操作')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {endpoints.map(endpoint => {
          const pending = (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
          return (
            <TableRow key={`${endpoint.adapter}\u0000${endpoint.name}`}>
              <TableCell className="max-w-[16rem] max-md:max-w-[11rem]">
                <Link to={endpointHref(endpoint.adapter, endpoint.name)} className="console-scope-row-link" title={`${endpoint.adapter} / ${endpoint.name}`}>
                  <Bot aria-hidden="true" /><span className="truncate">{endpoint.name}</span>
                </Link>
                {showAdapter ? <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">{endpoint.adapter}</span> : null}
              </TableCell>
              {showAdapter ? (
                <TableCell className="max-md:hidden"><Link to={adapterHref(endpoint.adapter)} className="text-sm hover:underline"><code>{endpoint.adapter}</code></Link></TableCell>
              ) : null}
              <TableCell>
                <span className="inline-flex flex-col items-start gap-0.5">
                  <AccountStatusBadge endpoint={endpoint} tasks={tasks} />
                  <span className="text-xs text-muted-foreground max-md:hidden">{i18n.t(endpointLifecycleLabel(endpoint))}</span>
                </span>
              </TableCell>
              <TableCell className="max-md:hidden">{pending ? <Badge variant="warning" size="sm">{i18n.t('{0} 条', [pending])}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  <Button asChild variant="outline" size="sm"><Link to={endpointHref(endpoint.adapter, endpoint.name, 'chat')} aria-label={i18n.t('聊天')}><MessageSquare /><span className="max-md:sr-only">{i18n.t('聊天')}</span></Link></Button>
                  <Button asChild variant="ghost" size="sm" className="max-md:hidden"><Link to={endpointHref(endpoint.adapter, endpoint.name, 'access')}><KeyRound />{i18n.t('接入')}</Link></Button>
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Logins waiting for someone, each linking to its account's 接入 tab (where it is completed). */
function WaitingLoginSection({ tasks }: { tasks: EndpointsAndLogin['tasks'] }) {
  const i18n = useI18n()
  const typeLabel = useLoginTaskTypeLabel()
  if (!tasks.length) return null
  return (
    <ObjectSection title={i18n.t('等待登录')} description={i18n.t('这些账号需要扫码或验证后才能上线。在账号的「接入」页签完成。')}>
      <Card className="overflow-hidden p-0">
        <ul className="console-scope-task-list">
          {tasks.map(task => (
            <li key={task.id}>
              <Link to={endpointHref(task.adapter, task.endpointKey, 'access')} className="console-scope-task">
                <WaitingLoginBadge />
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{task.endpointKey}</span> <code className="text-xs text-muted-foreground">{task.adapter}</code></span>
                <span className="text-xs text-muted-foreground">{typeLabel(task.type)}</span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </ObjectSection>
  )
}

/**
 * 概览 of 全局: totals, logins waiting, one row per adapter and per account (each linking to its
 * object page), and where to connect a new platform.
 */
export function GlobalOverview() {
  const i18n = useI18n()
  const data = useEndpointsAndLogin()
  const matrix = useFeatureMatrix()
  const adapters = useMemo(() => adapterOverview(data.endpoints, { tasks: data.tasks, known: matrix.source === 'rpc' ? matrix.endpoints : {} }), [data.endpoints, data.tasks, matrix.source, matrix.endpoints])
  const totals = overviewTotals(adapters)
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [query, setQuery] = useState('')
  const counts = accountCounts(data.endpoints, data.tasks)
  const accounts = filterAccounts(data.endpoints, { filter, query, tasks: data.tasks })
  const refresh = <Button variant="outline" size="sm" onClick={data.refresh} disabled={data.loading}><RefreshCw className={data.loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>
  if (data.error && !data.loaded) return <StatusState error={data.error} onRetry={data.refresh} />
  return (
    <>
      {data.loaded ? (
        <ObjectFacts items={[
          { label: i18n.t('适配器'), value: totals.adapters },
          { label: i18n.t('聊天账号'), value: totals.accounts },
          { label: i18n.t('在线'), value: <span className={cn(totals.accounts && totals.online < totals.accounts && 'text-warning')}>{i18n.t('{0} / {1}', [totals.online, totals.accounts])}</span> },
          { label: i18n.t('等待登录'), value: data.tasks.length },
          { label: i18n.t('待处理事件'), value: totals.pending },
        ]} />
      ) : <Skeleton className="h-20" />}
      {data.error ? <StatusState compact error={data.error} onRetry={data.refresh} description={i18n.t('刷新失败，下面是上一次读取的内容。')} /> : null}
      <WaitingLoginSection tasks={data.tasks} />
      <ObjectSection title={i18n.t('适配器')} description={i18n.t('每个适配器一页：账号、连接管理与功能覆盖。')} actions={refresh}>
        <Card className="overflow-hidden p-0">
          {!data.loaded ? <TableSkeleton /> : !adapters.length ? (
            <StatusState kind="empty" compact className="m-3" title={i18n.t('还没有运行中的适配器')} description={i18n.t('在下方选择平台接入第一个账号。')}
              actions={<Button size="sm" onClick={() => revealSection('.console-connect-platforms')}><Plus />{i18n.t('接入平台')}</Button>} />
          ) : (
            <Table aria-label={i18n.t('适配器')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t('适配器')}</TableHead>
                  <TableHead>{i18n.t('账号')}</TableHead>
                  <TableHead className="max-md:hidden">{i18n.t('待处理')}</TableHead>
                  <TableHead className="text-right">{i18n.t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adapters.map(item => (
                  <TableRow key={item.adapter}>
                    <TableCell>
                      <Link to={adapterHref(item.adapter)} className="console-scope-row-link"><Cable aria-hidden="true" /><code>{item.adapter}</code></Link>
                      {platformLabel(item.adapter) !== item.adapter ? <span className="console-scope-row-sub">{i18n.t(platformLabel(item.adapter))}</span> : null}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Badge variant={item.accounts && item.online === item.accounts ? 'success' : item.online ? 'warning' : 'outline'} size="sm" className="whitespace-nowrap">{i18n.t('{0} / {1} 在线', [item.online, item.accounts])}</Badge>
                        {item.waitingLogin ? <WaitingLoginBadge /> : null}
                        {item.configuredOnly.length ? <span className="text-xs text-muted-foreground max-md:hidden">{i18n.t('另有 {0} 个未运行', [item.configuredOnly.length])}</span> : null}
                      </span>
                    </TableCell>
                    <TableCell className="max-md:hidden">{item.pending ? <Badge variant="warning" size="sm">{i18n.t('{0} 条', [item.pending])}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm"><Link to={adapterHref(item.adapter, 'features')}><SlidersHorizontal />{i18n.t('功能')}</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </ObjectSection>
      {data.loaded && data.endpoints.length ? (
        <ObjectSection title={i18n.t('聊天账号')} description={i18n.t('点账号进入它的页面：会话、聊天、接入、功能与角色。')}>
          {data.endpoints.length > 3 ? (
            <div className="console-scope-toolbar">
              <div className="console-feature-filters" role="group" aria-label={i18n.t('账号状态')}>
                {ACCOUNT_FILTERS.map(id => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('console-feature-filter', filter === id && 'is-active')}>
                    {i18n.t(ACCOUNT_FILTER_LABELS[id])}<span className="console-feature-filter-count">{counts[id]}</span>
                  </button>
                ))}
              </div>
              <label className="console-feature-search">
                <Search aria-hidden="true" />
                <Input className="h-8" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('搜索账号…')} aria-label={i18n.t('搜索账号…')} />
              </label>
            </div>
          ) : null}
          <Card className="overflow-hidden p-0">
            {accounts.length ? <AccountTable endpoints={accounts} tasks={data.tasks} showAdapter label={i18n.t('聊天账号')} /> : (
              <StatusState kind="empty" compact className="m-3" title={i18n.t('没有符合筛选条件的聊天账号')}
                actions={<Button size="sm" variant="outline" onClick={() => { setFilter('all'); setQuery('') }}>{i18n.t('清除筛选')}</Button>} />
            )}
          </Card>
        </ObjectSection>
      ) : null}
      {data.loaded ? <OnboardingSection first={!data.endpoints.length} /> : null}
    </>
  )
}

/**
 * 概览 of an adapter: its accounts (each linking to its page), accounts known only from
 * configuration, and the adapter's own connection management (SDK `AdapterConsolePage`, given as
 * `management`).
 */
export function AdapterOverview({ scope, data, management }: { scope: Scope; data: EndpointsAndLogin; management: ReactNode }) {
  const i18n = useI18n()
  const adapter = scope.adapter!
  const matrix = useFeatureMatrix()
  const accounts = filterAccounts(data.endpoints.filter(endpoint => endpoint.adapter === adapter), { tasks: data.tasks })
  const item = adapterOverview(accounts, { tasks: loginTasksFor(data.tasks, adapter), known: matrix.source === 'rpc' ? { [adapter]: matrix.endpoints[adapter] ?? [] } : {} })[0]
  const conversationOverrides = matrix.conversationOverrides?.[adapter]
  const overriddenConversations = conversationOverrides ? Object.values(conversationOverrides).reduce((sum, count) => sum + count, 0) : 0
  return (
    <>
      {data.loaded ? (
        <ObjectFacts items={[
          { label: i18n.t('平台'), value: i18n.t(platformLabel(adapter)) },
          { label: i18n.t('聊天账号'), value: item?.accounts ?? 0 },
          { label: i18n.t('在线'), value: i18n.t('{0} / {1}', [item?.online ?? 0, item?.accounts ?? 0]) },
          { label: i18n.t('待处理事件'), value: item?.pending ?? 0 },
          { label: i18n.t('有覆盖的会话'), value: matrix.source === 'rpc' ? overriddenConversations : '—' },
        ]} />
      ) : <Skeleton className="h-20" />}
      <ObjectSection title={i18n.t('聊天账号')} description={i18n.t('点账号进入它的页面：会话、聊天、接入、功能与角色。')}>
        {data.error && !data.loaded ? <StatusState error={data.error} onRetry={data.refresh} /> : (
          <Card className="overflow-hidden p-0">
            {!data.loaded ? <TableSkeleton /> : accounts.length ? <AccountTable endpoints={accounts} tasks={data.tasks} showAdapter={false} label={i18n.t('聊天账号')} /> : (
              <StatusState kind="empty" compact className="m-3" title={i18n.t('这个适配器还没有运行中的账号')} description={i18n.t('在下方的连接管理里添加账号。')}
                actions={<Button size="sm" onClick={() => revealSection('.console-connection-manager')}><Plus />{i18n.t('添加账号')}</Button>} />
            )}
          </Card>
        )}
        {item?.configuredOnly.length ? (
          <div className="console-scope-known">
            <span className="text-muted-foreground">{i18n.t('配置中的其他账号（当前未运行）：')}</span>
            {item.configuredOnly.map(id => <Link key={id} to={endpointHref(adapter, id)} className="console-scope-chip"><Bot aria-hidden="true" />{id}</Link>)}
          </div>
        ) : null}
      </ObjectSection>
      {management}
    </>
  )
}

function ConversationLinkList({ items, adapter, endpoint }: { items: readonly ConversationItem[]; adapter: string; endpoint: string }) {
  const i18n = useI18n()
  return (
    <ul className="console-scope-task-list">
      {items.map(item => (
        <li key={item.key}>
          <Link to={conversationHref(adapter, endpoint, item.kind, item.id)} className="console-scope-task">
            <ConversationKindBadge kind={item.kind} />
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{item.name ?? item.id}</span>{item.name ? <code className="ml-2 text-xs text-muted-foreground">{item.id}</code> : null}</span>
            {item.hasOverrides ? <Badge variant="info" size="sm">{item.overrideCount ? i18n.t('{0} 个功能有覆盖', [item.overrideCount]) : i18n.t('有覆盖')}</Badge> : null}
            {item.lastActiveAt ? <span className="text-xs text-muted-foreground max-md:hidden">{new Date(item.lastActiveAt).toLocaleString(i18n.locale)}</span> : null}
            <ChevronRight aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * 概览 of an account: an information card with its key state, and a summary of its conversations
 * (those with overrides and the most recent ones). The full, searchable list is in 聊天.
 */
export function EndpointOverview({ scope, endpointInfo, onOpenTab }: {
  scope: Scope
  endpointInfo: ReturnType<typeof useEndpointInfo>
  onOpenTab: (tab: string) => void
}) {
  const i18n = useI18n()
  const adapter = scope.adapter!
  const endpoint = scope.endpoint!
  const { info, error, loaded } = endpointInfo
  const conversations = useConversationList({ adapter, endpoint })
  const highlights = conversationHighlights(conversations.page?.items ?? [])
  const pendingRequests = info?.pendingRequestCount ?? 0
  const pendingNotices = info?.pendingNoticeCount ?? 0
  return (
    <>
      {loaded && error && !info ? (
        <StatusState compact error={error} description={i18n.t('读取账号状态失败。会话与其他页签仍可使用。')} />
      ) : info ? (
        <ObjectFacts items={[
          { label: i18n.t('平台'), value: i18n.t(platformLabel(info.adapter)) },
          { label: i18n.t('运行状态'), value: i18n.t(endpointLifecycleLabel(info)) },
          ...(info.transportState ? [{ label: i18n.t('传输'), value: <code className="text-sm">{info.transportState}</code> }] : []),
          { label: i18n.t('好友申请与邀请'), value: pendingRequests },
          { label: i18n.t('通知'), value: pendingNotices },
        ]} />
      ) : !loaded ? <Skeleton className="h-20" /> : null}
      {info && !info.connected ? (
        <StatusState kind="disconnected" compact title={i18n.t('账号未连接')} description={i18n.t('在「接入」页签完成登录或测试连接。')}
          actions={<Button size="sm" variant="outline" onClick={() => onOpenTab('access')}><KeyRound />{i18n.t('打开接入')}</Button>} />
      ) : null}
      <ObjectSection title={i18n.t('会话')}
        description={i18n.t('有覆盖的会话与最近活跃的会话。全部会话在「聊天」页签里。')}
        // A real link to the account chat's list pane (?tab=chat, no conversation): back returns here.
        actions={<Button asChild variant="outline" size="sm"><Link to={scopeHref(scope, 'chat')}><MessagesSquare />{i18n.t('全部会话')}</Link></Button>}>
        {conversations.status === 'unsupported' || conversations.status === 'forbidden' ? (
          <StatusState kind={conversations.status} compact permissions={conversations.status === 'forbidden' ? ['feature.view'] : undefined}
            description={conversations.status === 'unsupported' ? i18n.t('会话摘要需要新版 Host。会话仍可在「聊天」页签中查看。') : undefined} />
        ) : conversations.status === 'error' ? <StatusState compact error={conversations.error} onRetry={conversations.refresh} />
          : conversations.status === 'loading' && !conversations.page ? <Skeleton className="h-24" />
            : !highlights.overridden.length && !highlights.recent.length ? (
              <StatusState kind="empty" compact title={i18n.t('还没有会话摘要')}
                description={conversations.page?.recentAvailable ? i18n.t('机器人在会话里收到消息后，最近的会话会出现在这里。') : i18n.t('在会话里改过功能设置后，它会出现在这里。')} />
            ) : (
              <div className="console-scope-split">
                {highlights.overridden.length ? (
                  <Card className="overflow-hidden p-0">
                    <h3 className="console-scope-card-title">{i18n.t('有覆盖的会话')}</h3>
                    <ConversationLinkList items={highlights.overridden} adapter={adapter} endpoint={endpoint} />
                  </Card>
                ) : null}
                {highlights.recent.length ? (
                  <Card className="overflow-hidden p-0">
                    <h3 className="console-scope-card-title">{i18n.t('最近活跃')}</h3>
                    <ConversationLinkList items={highlights.recent} adapter={adapter} endpoint={endpoint} />
                  </Card>
                ) : null}
              </div>
            )}
      </ObjectSection>
    </>
  )
}

/** 概览 of a conversation: identity, its account, and which features it overrides. */
export function ConversationOverview({ scope, item, levelMissing }: { scope: Scope; item: ConversationItem | undefined; levelMissing: 'unsupported' | 'forbidden' | null }) {
  const i18n = useI18n()
  const key = scopeKey(scope)
  // Display names come from `feature.list`, like the 功能 tab; the plugin id stays as the secondary label.
  const featureList = useFeatureList()
  const displayNames = useMemo(() => new Map((featureList.value?.features ?? []).map(feature => [feature.plugin, feature.displayName])), [featureList.value])
  return (
    <>
      <ObjectFacts items={[
        { label: i18n.t('类型'), value: <ConversationKindBadge kind={scope.kind!} /> },
        { label: i18n.t('会话 ID'), value: <code className="text-sm" title={scope.id}>{scope.id}</code> },
        { label: i18n.t('覆盖'), value: item?.overrides ? i18n.t('{0} 个功能', [item.overrides.length]) : '—' },
        ...(item?.lastActiveAt ? [{ label: i18n.t('最近活跃'), value: new Date(item.lastActiveAt).toLocaleString(i18n.locale) }] : []),
      ]} />
      {key === null ? (
        <StatusState kind="unsupported" title={i18n.t('这个会话不能单独配置')} description={i18n.t('适配器名称不是实例别名，或账号 ID 含有不支持的字符；聊天仍可使用。')} />
      ) : levelMissing ? (
        <StatusState kind={levelMissing} compact permissions={levelMissing === 'forbidden' ? ['feature.view'] : undefined}
          description={levelMissing === 'unsupported' ? i18n.t('按会话配置功能需要新版 Host。当前会话使用账号的配置。') : undefined} />
      ) : (
        <ObjectSection title={i18n.t('这个会话的覆盖')} description={i18n.t('在这个会话里单独改过的功能。修改在「功能」页签。')}
          actions={<Button asChild variant="outline" size="sm"><Link to={scopeHref(scope, 'features')}><SlidersHorizontal />{i18n.t('功能设置')}</Link></Button>}>
          {item?.overrides?.length ? (
            <Card className="overflow-hidden p-0">
              <ul className="console-scope-task-list">
                {item.overrides.map(entry => (
                  <li key={entry.plugin}>
                    <Link to={scopeHref(scope, 'features')} className="console-scope-task">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{displayNames.get(entry.plugin) ?? entry.plugin}</span>
                      {displayNames.get(entry.plugin) && displayNames.get(entry.plugin) !== entry.plugin ? <code className="ml-2 text-xs text-muted-foreground">{entry.plugin}</code> : null}
                    </span>
                    {entry.disabled ? <Badge variant="outline" size="sm">{i18n.t('已关闭')}</Badge> : null}
                    {entry.fields.length ? <span className="text-xs text-muted-foreground">{i18n.t('字段：{0}', [entry.fields.join('、')])}</span> : null}
                    {entry.updatedAt ? <span className="text-xs text-muted-foreground max-md:hidden">{new Date(entry.updatedAt).toLocaleString(i18n.locale)}</span> : null}
                    <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <StatusState kind="empty" compact title={i18n.t('没有覆盖')} description={i18n.t('这个会话沿用账号、适配器与全局的功能设置。')}
              actions={<Button asChild size="sm" variant="outline"><Link to={scopeHref(scope, 'features')}><Plus />{i18n.t('设置功能')}</Link></Button>} />
          )}
        </ObjectSection>
      )}
    </>
  )
}
