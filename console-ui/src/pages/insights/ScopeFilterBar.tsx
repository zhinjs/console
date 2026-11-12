import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Filter, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { CONVERSATION_KIND_LABELS, SCOPE_LEVEL_LABELS } from '../../scope/scope-tree.mjs'
import { clearScopeFilter, readScopeFilter, scopeObjectHref, type ScopeFilter } from './scope-filter.mjs'
import './insights.css'

/** Current range from `?adapter=&endpoint=&conversation=` (see scope-filter.mjs). */
export function useScopeFilter(): ScopeFilter {
  const [params] = useSearchParams()
  return readScopeFilter(params)
}

/**
 * 「范围：qq / bot-1 / group:123」条：说明页面只看哪个对象，可回到对象页或清除范围。
 * `note` 说明这一页按范围过滤的口径（例如日志只能按文本匹配）。
 */
export function ScopeFilterBar({ filter, note, onClear }: { filter: ScopeFilter; note?: ReactNode; onClear?: () => void }) {
  const i18n = useI18n()
  const [, setParams] = useSearchParams()
  if (!filter.active) return null
  const scope = filter.scope
  const level = scope.level === 'conversation' && scope.kind ? i18n.t(CONVERSATION_KIND_LABELS[scope.kind]) : i18n.t(SCOPE_LEVEL_LABELS[scope.level])
  const clear = () => {
    if (onClear) onClear()
    else setParams(previous => clearScopeFilter(previous), { replace: true })
  }
  return (
    <div className="console-scope-filter" role="status">
      <Filter className="console-scope-filter-icon" aria-hidden="true" />
      <div className="console-scope-filter-text">
        <p>
          <span className="console-scope-filter-label">{i18n.t('范围')}</span>
          <span className="console-scope-filter-level">{level}</span>
          <code title={filter.identity}>{filter.identity}</code>
        </p>
        {filter.invalid ? <p className="console-scope-filter-note">{i18n.t('会话参数 {0} 无法识别，只按账号过滤。', [filter.invalid])}</p> : null}
        {note ? <p className="console-scope-filter-note">{note}</p> : null}
      </div>
      <div className="console-scope-filter-actions">
        <Button asChild variant="ghost" size="sm"><Link to={scopeObjectHref(scope)}>{i18n.t('打开对象页')}<ArrowUpRight /></Link></Button>
        <Button variant="outline" size="sm" onClick={clear}><X />{i18n.t('清除范围')}</Button>
      </div>
    </div>
  )
}
