import { useState } from 'react'
import { ArrowUpRight, FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CONSOLE_PATHS } from '../../console-routes.mjs'
import { Button, cn } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import type { AttentionItem } from './attention-model.mjs'
import { AttentionSeverityIcon } from './AttentionItemRow'
import { AttentionMorePanel, AttentionMoreToggle, attentionMoreId } from './AttentionMore'

/**
 * The dashboard's 「需要你处理」: one list, each row an icon, one sentence and the action that fixes
 * it. Details and ids open per row with 「详情」. Same row shape as the /attention page (console#125).
 */
export function AttentionSummaryList({ items }: { items: readonly AttentionItem[] }) {
  const i18n = useI18n()
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <ul className="console-attention-list is-summary">
      {items.map(item => {
        const expanded = open.has(item.id)
        const moreId = attentionMoreId('attention-summary', item.id)
        return (
          <li key={item.id} className={cn('console-attention-row', `is-${item.severity}`)}>
            <AttentionSeverityIcon severity={item.severity} />
            <div className="console-attention-row-body">
              <p className="console-attention-row-title">{item.title}</p>
              <AttentionMorePanel id={moreId} item={item} detail expanded={expanded} />
            </div>
            <div className="console-attention-row-actions">
              <AttentionMoreToggle expanded={expanded} controls={moreId} onToggle={() => toggle(item.id)} />
              {item.simulationOnly ? (
                <Button asChild variant="secondary" size="sm">
                  <Link to={CONSOLE_PATHS.sandbox}><FlaskConical />{i18n.t('打开 Sandbox')}</Link>
                </Button>
              ) : null}
              <Button asChild variant="secondary" size="sm">
                <Link to={item.action.path}>{item.action.label || i18n.t('去处理')}<ArrowUpRight /></Link>
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
