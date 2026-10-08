import { useState } from 'react'
import { fullValueText, valuePreview } from './record-value-preview.mjs'

export function RecordValueDisclosure({ value, summary, label = '查看完整值' }: {
  value: unknown
  summary?: string
  label?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return <div className="min-w-0 max-w-full space-y-2">
    <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{summary ?? valuePreview(value)}</p>
    <details className="min-w-0 max-w-full" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="w-fit cursor-pointer rounded-md text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
      {expanded && <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/30 p-3 font-mono text-xs [overflow-wrap:anywhere]">{fullValueText(value)}</pre>}
    </details>
  </div>
}
