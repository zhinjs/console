import { useEffect, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { StatusState } from '../components/StatusState'
import { CONVERSATION_KIND_LABELS } from '../scope/scope-tree.mjs'
import { useConversationList } from './features/use-feature-data'
import type { ConversationKind } from './features/feature-model.mjs'
import './insights/insights.css'

/**
 * 任务投递目标的会话选择：在选定账号下搜索 Host 已知的会话（`feature.conversations`），
 * 输入停顿 300ms 再查。选中只填草稿，最终目标仍在预览里核对；列表外的会话走「手动填写」。
 */
export function TaskConversationChoice({ endpoint, disabled, selected, onPick }: {
  endpoint: { adapter: string; id: string }
  disabled?: boolean
  selected: { kind: string; id: string }
  onPick: (kind: ConversationKind, id: string) => void
}) {
  const i18n = useI18n()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [draft])
  const list = useConversationList({ adapter: endpoint.adapter, endpoint: endpoint.id, query })
  const items = list.page?.items ?? []
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{i18n.t("选择会话")}</p>
      <Input value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)}
        placeholder={i18n.t("搜索会话名称或 ID")} aria-label={i18n.t("搜索会话名称或 ID")} />
      {list.status === 'loading' && !list.page ? <div className="space-y-1"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
        : list.status !== 'ready' && list.status !== 'loading'
          ? <StatusState compact error={list.error ?? list.status} kind={list.status === 'unsupported' ? 'unsupported' : list.status === 'forbidden' ? 'forbidden' : undefined}
            description={i18n.t("会话列表暂时读不到，可以在下方手动填写。")} onRetry={list.refresh} />
          : !items.length
            ? <p className="text-xs text-muted-foreground">{query ? i18n.t("没有匹配的会话，可以换个关键词或手动填写。") : i18n.t("这个账号还没有已知的会话，可以手动填写。")}</p>
            : (
              <div className="console-conversation-choice-list" role="list">
                {items.map(item => {
                  const pressed = selected.kind === item.kind && selected.id === item.id
                  return (
                    <button key={item.key} type="button" role="listitem" disabled={disabled} aria-pressed={pressed}
                      className="console-conversation-choice" onClick={() => onPick(item.kind as ConversationKind, item.id)}>
                      <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 truncate">{item.name ?? item.id}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{i18n.t(CONVERSATION_KIND_LABELS[item.kind as ConversationKind] ?? item.kind)}</span>
                      <code title={`${item.kind}:${item.id}`}>{item.kind}:{item.id}</code>
                    </button>
                  )
                })}
                {list.page?.cursor ? <Button variant="ghost" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? i18n.t("加载中…") : i18n.t("加载更多")}</Button> : null}
              </div>
            )}
    </div>
  )
}
