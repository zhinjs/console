import { ChevronDown } from 'lucide-react'
import { Button, cn } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import type { AttentionItem } from './attention-model.mjs'

/** DOM id of an item's collapsed part; ids such as `login.pending:3f1a90c2` are made safe for an attribute. */
export function attentionMoreId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/**
 * 「详情」 toggle and the part it opens: the long detail (raw session ids, config paths …) when
 * `detail` is set, and the item's own id. Collapsed by default, so a row stays one sentence.
 */
export function AttentionMoreToggle({ expanded, controls, onToggle, inline }: {
  expanded: boolean
  controls: string
  onToggle: () => void
  /** A text-sized toggle for a meta line (the /attention page), instead of a small ghost button. */
  inline?: boolean
}) {
  const i18n = useI18n()
  if (inline) return (
    <button type="button" className="console-attention-more-link" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      {expanded ? i18n.t('收起') : i18n.t('详情')}
      <ChevronDown aria-hidden="true" className={cn('console-attention-more-chevron', expanded && 'is-open')} />
    </button>
  )
  return (
    <Button type="button" variant="ghost" size="sm" className="console-attention-more-toggle" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      {expanded ? i18n.t('收起') : i18n.t('详情')}
      <ChevronDown aria-hidden="true" className={cn('console-attention-more-chevron', expanded && 'is-open')} />
    </Button>
  )
}

export function AttentionMorePanel({ id, item, detail, expanded }: { id: string; item: AttentionItem; detail: boolean; expanded: boolean }) {
  const i18n = useI18n()
  return (
    <div id={id} className="console-attention-more" hidden={!expanded}>
      {detail && item.detail ? <p className="console-attention-row-detail">{item.detail}</p> : null}
      <p className="console-attention-row-id">{i18n.t('编号')}<code className="console-code">{item.id}</code></p>
    </div>
  )
}
