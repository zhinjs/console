import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Cable, ChevronsUpDown, Globe2, MessagesSquare, ShieldCheck, UserRound } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { Skeleton } from '../components/ui/skeleton'
import { useIsMobile } from '../hooks/useIsMobile'
import { useConversationList, useEndpointList } from '../pages/features/use-feature-data'
import {
  CONVERSATION_KIND_LABELS, SCOPE_LEVEL_LABELS, scopeHref, scopeIdentity, scopeLevel, scopePickerTree, type ScopeRef, type ScopeTab,
} from './scope-tree.mjs'

export interface ScopePickerProps {
  readonly scope: ScopeRef
  /** Keep this tab when switching to another object of a level that has it. */
  readonly tab?: ScopeTab
  readonly className?: string
}

/**
 * Switches between objects of the four-level tree (全局 / 适配器 / 账号 / 会话), always showing the
 * full identity. Choosing a scope only changes what is shown: it never grants a permission.
 * Desktop: a popover next to the page title. Phone (< 768px): a bottom sheet (列表 → 内容).
 */
export function ScopePicker({ scope, tab, className }: ScopePickerProps) {
  const i18n = useI18n()
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const level = scopeLevel(scope)
  const trigger = (
    <Button variant="outline" size="sm" className={cn('console-scope-picker-trigger', className)} aria-haspopup="dialog" aria-expanded={open}
      onClick={mobile ? () => setOpen(true) : undefined}>
      <ChevronsUpDown aria-hidden="true" />
      <span>{i18n.t('切换范围')}</span>
    </Button>
  )
  const body = open ? <ScopePickerBody scope={scope} tab={tab} onPick={() => setOpen(false)} /> : null
  if (mobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="console-scope-picker-sheet">
            <SheetHeader>
              <SheetTitle>{i18n.t('切换范围')}</SheetTitle>
              <SheetDescription>{i18n.t('当前：{0}', [level === 'global' ? i18n.t('全局') : scopeIdentity(scope)])}</SheetDescription>
            </SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="console-scope-picker-popover">{body}</PopoverContent>
    </Popover>
  )
}

function PickerLink({ to, current, icon, label, identity, meta, onPick, depth }: {
  to: string; current: boolean; icon: ReactNode; label: string; identity?: string; meta?: ReactNode; onPick: () => void; depth: number
}) {
  return (
    <Link to={to} onClick={onPick} aria-current={current ? 'page' : undefined}
      className={cn('console-scope-picker-item', current && 'is-current')} style={{ paddingInlineStart: `${0.5 + depth * 1}rem` }}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="console-scope-picker-label">{label}</span>
        {identity ? <span className="console-scope-picker-identity">{identity}</span> : null}
      </span>
      {meta}
    </Link>
  )
}

interface BodyProps { readonly scope: ScopeRef; readonly tab?: ScopeTab; readonly onPick: () => void }

/** Conversations are listed only under the current account (one `feature.conversations` page). */
function ScopePickerBody(props: BodyProps) {
  const level = scopeLevel(props.scope)
  return level === 'endpoint' || level === 'conversation' ? <AccountPickerBody {...props} /> : <PickerTree {...props} rows={[]} />
}

function AccountPickerBody(props: BodyProps) {
  const conversations = useConversationList({ adapter: props.scope.adapter, endpoint: props.scope.endpoint })
  return <PickerTree {...props} rows={conversations.status === 'ready' ? conversations.page?.items ?? [] : []} />
}

function PickerTree({ scope, tab, onPick, rows }: BodyProps & { rows: readonly { kind: string; id: string; name?: string }[] }) {
  const i18n = useI18n()
  const level = scopeLevel(scope)
  const [query, setQuery] = useState('')
  const endpoints = useEndpointList()
  const tree = scopePickerTree(endpoints.endpoints, scope, rows)
  const needle = query.trim().toLocaleLowerCase()
  const matches = (...values: (string | undefined)[]) => !needle || values.some(value => value?.toLocaleLowerCase().includes(needle))
  const href = (target: ScopeRef) => scopeHref(target, tab)
  return (
    <div className="console-scope-picker">
      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('搜索适配器、账号或会话')} aria-label={i18n.t('搜索适配器、账号或会话')} />
      <div className="console-scope-picker-list" role="list">
        <PickerLink to={href({})} current={level === 'global'} depth={0} onPick={onPick}
          icon={<Globe2 className="console-scope-picker-icon" aria-hidden="true" />} label={i18n.t('全局')} identity={i18n.t('所有适配器、账号与会话')} />
        {endpoints.loading && !endpoints.loaded ? <div className="space-y-1 p-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : null}
        {tree.map(adapter => {
          const accounts = adapter.accounts.filter(item => matches(adapter.adapter, item.endpoint, ...item.conversations.flatMap(row => [row.id, row.name])))
          if (!matches(adapter.adapter) && !accounts.length) return null
          return (
            <div key={adapter.adapter} role="listitem">
              <PickerLink to={href({ adapter: adapter.adapter })} current={level === 'adapter' && adapter.current} depth={1} onPick={onPick}
                icon={<Cable className="console-scope-picker-icon" aria-hidden="true" />} label={adapter.adapter} identity={i18n.t(SCOPE_LEVEL_LABELS.adapter)} />
              {accounts.map(item => (
                <div key={item.endpoint}>
                  <PickerLink to={href({ adapter: adapter.adapter, endpoint: item.endpoint })} current={level === 'endpoint' && item.current} depth={2} onPick={onPick}
                    icon={<UserRound className="console-scope-picker-icon" aria-hidden="true" />} label={item.endpoint}
                    identity={`${adapter.adapter} / ${item.endpoint}`}
                    meta={<span className={cn('console-scope-picker-dot', item.connected ? 'is-online' : 'is-offline')} title={item.connected ? i18n.t('在线') : i18n.t('离线')} />} />
                  {item.conversations.filter(row => matches(row.id, row.name)).map(row => (
                    <PickerLink key={`${row.kind}:${row.id}`} depth={3} onPick={onPick}
                      to={href({ adapter: adapter.adapter, endpoint: item.endpoint, kind: row.kind, id: row.id })}
                      current={level === 'conversation' && scope.kind === row.kind && scope.id === row.id}
                      icon={<MessagesSquare className="console-scope-picker-icon" aria-hidden="true" />}
                      label={row.name ?? row.id}
                      identity={`${i18n.t(CONVERSATION_KIND_LABELS[row.kind])} · ${row.kind}:${row.id}`} />
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <p className="console-scope-picker-note"><ShieldCheck aria-hidden="true" />{i18n.t('切换范围只改变查看的对象，不会授予权限。')}</p>
    </div>
  )
}
