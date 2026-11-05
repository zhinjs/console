import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/badge'
import { useI18n } from '../../i18n'
import type { SupportMetadata } from './model.mjs'

/** A display hint only: missing metadata never changes a candidate's availability. */
export function SupportLabel({ label, support }: {
  label: ReactNode
  support?: SupportMetadata
}) {
  const i18n = useI18n()
  if (support?.status !== 'experimental') return <>{label}</>
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={typeof label === 'string' ? label : undefined}
    >
      <span className="truncate">{label}</span>
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-xs">
        {i18n.t('实验')}
      </Badge>
    </span>
  )
}

/** Preserve ordinary string options and their existing Select tooltip/typeahead behavior. */
export function supportLabel(label: string, support?: SupportMetadata): ReactNode {
  return support?.status === 'experimental'
    ? <SupportLabel label={label} support={support} />
    : label
}

/** Render declaration text once in the active detail or login flow, never as HTML. */
export function SupportNotice({ support }: { support?: SupportMetadata }) {
  const i18n = useI18n()
  const declared = support?.status === 'standard' || support?.status === 'experimental'
  return declared && typeof support.notice === 'string' && support.notice ? (
    <p className="text-sm text-muted-foreground">{i18n.t(support.notice)}</p>
  ) : null
}
