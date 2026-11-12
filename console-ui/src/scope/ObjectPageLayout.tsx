import { useCallback, useId, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Copy, Lock, type LucideIcon } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../i18n'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { StatusState } from '../components/StatusState'
import { PageShell } from '../components/PageShell'
import { useConsoleAccess } from '../hooks/use-console-access'
import { copyText } from '../pages/clipboard-copy.mjs'
import { ScopeBreadcrumb, type ScopeNames } from './ScopeBreadcrumb'
import { ScopePicker } from './ScopePicker'
import {
  CONVERSATION_KIND_LABELS, DEFAULT_SCOPE_TAB, SCOPE_LEVEL_LABELS, SCOPE_TAB_LABELS, SCOPE_TAB_PARAM, SCOPE_TAB_PERMISSIONS, SCOPE_TABS,
  resolveScopeTab, scopeIdentity, scopeKey, scopeTabAllowed, type Scope, type ScopeTab,
} from './scope-tree.mjs'
import './object-page.css'

export interface ObjectPageLayoutProps {
  readonly scope: Scope
  /** Display name (falls back to the raw identity). */
  readonly title: string
  /** One line under the title, already translated. */
  readonly description?: string
  readonly icon?: LucideIcon
  /** Platform / adapter type shown as a chip (e.g. `icqq`). */
  readonly platform?: string
  /** Online / offline / locked … badge. */
  readonly status?: ReactNode
  /** Header actions (refresh, 打开聊天 …); the scope picker is always added. */
  readonly actions?: ReactNode
  /** Display names for the breadcrumb. */
  readonly names?: ScopeNames
  /** Content per tab. The level decides which tabs exist and their order (SCOPE_TABS). */
  readonly panels: Partial<Record<ScopeTab, ReactNode>>
  /** Small counters next to tab labels. */
  readonly badges?: Partial<Record<ScopeTab, ReactNode>>
  /** Tabs whose content runs edge to edge (e.g. 聊天). */
  readonly flushTabs?: readonly ScopeTab[]
  /** Optional side column (children list) shown from 1440px; below that it stacks under the header. */
  readonly aside?: ReactNode
}

/** Current tab from `?tab=`; selecting another tab replaces the history entry (no back-button trail). */
export function useScopeTab(level: Scope['level']): [ScopeTab, (tab: string) => void] {
  const [params, setParams] = useSearchParams()
  const tab = resolveScopeTab(level, params.get(SCOPE_TAB_PARAM))
  const select = useCallback((next: string) => {
    setParams(previous => {
      const query = new URLSearchParams(previous)
      if (next === DEFAULT_SCOPE_TAB) query.delete(SCOPE_TAB_PARAM); else query.set(SCOPE_TAB_PARAM, next)
      return query
    }, { replace: true })
  }, [setParams])
  return [tab, select]
}

function IdentityCopy({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const [copied, setCopied] = useState(false)
  const key = scopeKey(scope)
  const identity = scopeIdentity(scope)
  if (!identity) return null
  const copy = () => {
    void copyText(key ?? identity, navigator.clipboard, document).then(ok => {
      setCopied(ok)
      if (ok) window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="console-object-identity">
      <code title={key ?? undefined}>{identity}</code>
      <Button variant="ghost" size="icon" className="console-object-identity-copy" onClick={copy}
        aria-label={copied ? i18n.t('已复制') : i18n.t('复制范围键')} title={key ?? identity}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </span>
  )
}

/**
 * One object of the tree (全局 / 适配器 / 账号 / 会话): header with identity, platform and status,
 * the breadcrumb of its scope, and the tabs of its level. Tabs the principal cannot use stay visible
 * and explain the missing permission. Only the open tab is mounted.
 */
export function ObjectPageLayout({
  scope, title, description, icon: Icon, platform, status, actions, names, panels, badges, flushTabs = [], aside,
}: ObjectPageLayoutProps) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const [tab, selectTab] = useScopeTab(scope.level)
  const tabs = SCOPE_TABS[scope.level]
  const levelLabel = scope.level === 'conversation' && scope.kind ? i18n.t(CONVERSATION_KIND_LABELS[scope.kind]) : i18n.t(SCOPE_LEVEL_LABELS[scope.level])
  return (
    <PageShell className={cn('console-object-page', aside ? 'has-aside' : undefined)}>
      <header className="console-object-header">
        {scope.level === 'global' ? null : <ScopeBreadcrumb scope={scope} names={names} />}
        <div className="console-object-heading">
          {Icon ? <span className="console-object-avatar" aria-hidden="true"><Icon /></span> : null}
          <div className="console-object-titles">
            <div className="console-object-title-row">
              <h1 className="console-page-title">{title}</h1>
              {scope.level === 'global' ? null : <Badge variant="secondary" size="sm">{levelLabel}</Badge>}
              {platform ? <Badge variant="outline" size="sm">{platform}</Badge> : null}
              {status}
            </div>
            {description ? <p className="console-page-description">{description}</p> : null}
            <IdentityCopy scope={scope} />
          </div>
          <div className="console-object-actions">
            {actions}
            <ScopePicker scope={scope} tab={tab} />
          </div>
        </div>
      </header>
      <div className="console-object-body">
        {aside ? <aside className="console-object-aside" aria-label={i18n.t('下级对象')}>{aside}</aside> : null}
        <Tabs value={tab} onValueChange={selectTab} className="console-object-tabs">
          <div className="console-object-tablist-scroll">
            <TabsList aria-label={i18n.t('页签')}>
              {tabs.map(id => {
                const allowed = scopeTabAllowed(id, scope, access)
                return (
                  <TabsTrigger key={id} value={id} className="console-object-tab">
                    {allowed ? null : <Lock className="console-object-tab-lock" aria-label={i18n.t('无权限')} />}
                    {i18n.t(SCOPE_TAB_LABELS[id])}
                    {badges?.[id] !== undefined && badges[id] !== null ? <span className="console-object-tab-badge">{badges[id]}</span> : null}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>
          {tabs.map(id => (
            <TabsContent key={id} value={id} className={cn('console-object-panel', flushTabs.includes(id) && 'is-flush')}>
              {scopeTabAllowed(id, scope, access)
                ? panels[id] ?? <StatusState kind="empty" title={i18n.t('这一页签还没有内容')} />
                : <StatusState kind="forbidden" permissions={SCOPE_TAB_PERMISSIONS[id]} />}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </PageShell>
  )
}

/** A titled block inside a tab (表单分组 / 列表区块), see the guidelines. */
export function ObjectSection({ title, description, actions, children, className }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('console-object-section', className)}>
      <div className="console-object-section-head">
        <div className="min-w-0">
          <h2 id={id} className="console-section-title">{title}</h2>
          {description ? <p className="console-object-section-description">{description}</p> : null}
        </div>
        {actions ? <div className="console-object-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
