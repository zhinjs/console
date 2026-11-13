import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Search } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { conversationHref, endpointHref } from '../../console-routes.mjs'
import { conversationOverrideCounts, filterConversations, type ConversationItem, type ConversationKind, type ConversationOverrideCounts } from './feature-model.mjs'
import { type ConversationListState } from './use-feature-data'

export function ConversationKindBadge({ kind }: { kind: ConversationKind }) {
  const i18n = useI18n()
  const label = kind === 'group' ? i18n.t("群聊") : kind === 'private' ? i18n.t("私聊") : i18n.t("频道")
  return <Badge variant={kind === 'private' ? 'outline' : 'secondary'} size="sm">{label}</Badge>
}

/** "N 个会话有覆盖" per endpoint of one alias, when the Host reports counts (ADR 0055). */
export function ConversationOverrideLinks({ counts, adapter }: { counts: ConversationOverrideCounts | undefined; adapter: string }) {
  const i18n = useI18n()
  const entries = conversationOverrideCounts(counts, adapter)
  if (!entries.length) return null
  return (
    <span className="flex flex-col gap-0.5 font-normal">
      {entries.map(({ endpoint, count }) => (
        <Link key={endpoint} to={endpointHref(adapter, endpoint)} className="text-xs text-muted-foreground hover:underline">
          {i18n.t("{0}：{1} 个会话有覆盖", [endpoint, count])}
        </Link>
      ))}
    </span>
  )
}

function OverrideSummary({ item }: { item: ConversationItem }) {
  const i18n = useI18n()
  if (item.overrideCount !== null) {
    const disabled = item.overrides?.filter(entry => entry.disabled).length ?? 0
    return item.overrideCount
      ? (
        <span className="inline-flex flex-wrap items-center gap-1" title={item.overrides?.map(entry => entry.plugin).join(', ')}>
          <Badge variant="info" size="sm">{i18n.t("{0} 个功能有覆盖", [item.overrideCount])}</Badge>
          {disabled ? <Badge variant="outline" size="sm">{i18n.t("{0} 个已关闭", [disabled])}</Badge> : null}
        </span>
      )
      : <span className="text-xs text-muted-foreground">{i18n.t("无覆盖")}</span>
  }
  return item.hasOverrides ? <Badge variant="info" size="sm">{i18n.t("有覆盖")}</Badge> : <span className="text-xs text-muted-foreground">{i18n.t("无覆盖")}</span>
}

interface ConversationListProps {
  readonly adapter: string
  readonly endpoint: string
  readonly list: ConversationListState
  readonly query: string
  readonly onQueryChange: (query: string) => void
}

/** An account's conversations (ADR 0055 §6), each linking to its object page: searchable, paginated, "only with overrides" filter. */
export function ConversationList({ adapter, endpoint, list, query, onQueryChange }: ConversationListProps) {
  const i18n = useI18n()
  const [draft, setDraft] = useState(query)
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  // Search runs on the Host; wait for typing to pause.
  useEffect(() => {
    const timer = setTimeout(() => { if (draft !== query) onQueryChange(draft) }, 300)
    return () => clearTimeout(timer)
  }, [draft, query, onQueryChange])
  const items = filterConversations(list.page?.items ?? [], onlyOverridden)
  return (
    <section aria-labelledby="endpoint-conversations" className="space-y-3">
      <h2 id="endpoint-conversations" className="sr-only">{i18n.t("会话")}</h2>
      <p className="text-sm text-muted-foreground">{i18n.t("按群聊、私聊或频道单独开关功能、调整参数。上级禁用的功能在会话里不能打开。")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" type="search" value={draft} onChange={event => setDraft(event.target.value)}
            placeholder={i18n.t("搜索会话名称或 ID")} aria-label={i18n.t("搜索会话")} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox checked={onlyOverridden} onCheckedChange={checked => setOnlyOverridden(checked === true)} />
          {i18n.t("只看有覆盖的会话")}
        </label>
        <Button variant="outline" size="sm" onClick={list.refresh} disabled={list.status === 'loading'}>
          <RefreshCw className={list.status === 'loading' ? 'animate-spin' : ''} />{i18n.t("刷新")}
        </Button>
      </div>
      {list.error && list.status === 'error' ? <ErrorAlert error={list.error} onRetry={list.refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {list.status === 'loading' && !list.page ? (
          <StatusState kind="loading" className="m-4" placeholder={<div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>} />
        ) : !items.length ? (
          <StatusState kind="empty" compact className="m-3"
            title={query || onlyOverridden ? i18n.t("没有符合条件的会话") : i18n.t("还没有会话级配置")}
            description={query || onlyOverridden ? i18n.t("换一个关键词，或清除筛选。") : list.page?.recentAvailable
              ? i18n.t("机器人在会话里收到消息后，会话会出现在这里。")
              : i18n.t("在会话里改过开关或参数后，它会出现在这里。")}
            actions={query || onlyOverridden
              ? <Button size="sm" variant="outline" onClick={() => { setDraft(''); onQueryChange(''); setOnlyOverridden(false) }}>{i18n.t("清除筛选")}</Button>
              : <Button asChild size="sm" variant="outline"><Link to="/scope">{i18n.t("打开账号与会话")}</Link></Button>} />
        ) : (
          <Table aria-label={i18n.t("会话")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("类型")}</TableHead>
                <TableHead>{i18n.t("会话")}</TableHead>
                <TableHead>{i18n.t("覆盖")}</TableHead>
                <TableHead className="text-right">{i18n.t("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => (
                <TableRow key={item.key}>
                  <TableCell><ConversationKindBadge kind={item.kind} /></TableCell>
                  <TableCell>
                    <Link to={conversationHref(adapter, endpoint, item.kind, item.id)} className="font-medium hover:underline">{item.name ?? item.id}</Link>
                    {item.name ? <code className="ml-2 text-xs text-muted-foreground">{item.id}</code> : null}
                  </TableCell>
                  <TableCell><OverrideSummary item={item} /></TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link to={conversationHref(adapter, endpoint, item.kind, item.id, 'features')}>{i18n.t("功能配置")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {list.page?.cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>{i18n.t("加载更多")}</Button>
        </div>
      ) : null}
    </section>
  )
}
