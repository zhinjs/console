import { useMemo } from 'react'
import { parseAnsi } from '../utils/ansi-log.mjs'
import './ansi-text.css'

/**
 * One terminal line with its SGR colours mapped to theme tokens (`utils/ansi-log.mjs`); other
 * escape sequences are dropped, so raw `[90m` never reaches the page.
 */
export function AnsiText({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text])
  return (
    <>
      {segments.map((segment, index) => {
        const classes = [
          segment.tone ? `console-ansi-${segment.tone}` : '',
          segment.bold ? 'console-ansi-bold' : '',
          segment.dim ? 'console-ansi-dim' : '',
          segment.italic ? 'console-ansi-italic' : '',
          segment.underline ? 'console-ansi-underline' : '',
        ].filter(Boolean).join(' ')
        return classes ? <span key={index} className={classes}>{segment.text}</span> : <span key={index}>{segment.text}</span>
      })}
    </>
  )
}

/** Several lines (a log tail), one per row. */
export function AnsiLines({ lines }: { lines: readonly string[] }) {
  return <>{lines.map((line, index) => <div key={index}><AnsiText text={line} /></div>)}</>
}
