import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../i18n'
import { CONVERSATION_KIND_LABELS, SCOPE_LEVEL_LABELS, scopeCrumbs, type ScopeRef } from './scope-tree.mjs'

export interface ScopeNames {
  readonly adapter?: string
  readonly endpoint?: string
  readonly conversation?: string
}

/**
 * 全局 › 适配器 › 账号 › 会话. Each ancestor links to its object page; the last one is the current
 * page. Every crumb carries its level name, and the raw identity stays in the title attribute when
 * a display name is shown.
 */
export function ScopeBreadcrumb({ scope, names, className }: { scope: ScopeRef; names?: ScopeNames; className?: string }) {
  const i18n = useI18n()
  const crumbs = scopeCrumbs(scope, names)
  return (
    <nav aria-label={i18n.t('范围')} className={cn('console-scope-breadcrumb', className)}>
      <ol>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          const raw = crumb.level === 'adapter' ? crumb.scope.adapter
            : crumb.level === 'endpoint' ? crumb.scope.endpoint
              : crumb.level === 'conversation' ? `${crumb.scope.kind}:${crumb.scope.id}` : undefined
          const label = crumb.level === 'global' ? i18n.t(crumb.label) : crumb.label
          const level = crumb.level === 'conversation' && crumb.scope.kind
            ? i18n.t(CONVERSATION_KIND_LABELS[crumb.scope.kind])
            : i18n.t(SCOPE_LEVEL_LABELS[crumb.level])
          const content = <>
            {crumb.level !== 'global' ? <span className="console-scope-crumb-level">{level}</span> : null}
            <span className="console-scope-crumb-label">{label}</span>
          </>
          return (
            <li key={crumb.href}>
              {index ? <ChevronRight className="console-scope-crumb-separator" aria-hidden="true" /> : null}
              {last
                ? <span className="console-scope-crumb is-current" aria-current="page" title={raw}>{content}</span>
                : <Link to={crumb.href} className="console-scope-crumb" title={raw}>{content}</Link>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
