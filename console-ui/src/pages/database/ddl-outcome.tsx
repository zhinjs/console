import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, SearchCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import type { DdlCheckResult } from './ddl-outcome-model.mjs'

/** A DDL whose outcome is unknown (#64 `database-ddl-unknown-outcome`): held until 「核对」 settles it. */
export interface HeldDdl<T> { readonly subject: T; readonly text: string; readonly details: string }

/**
 * Holds a DDL with an unknown outcome and runs its 「核对」. While `held` is set the action must stay
 * blocked; `check` runs `verify` once and records what it found.
 */
export function useDdlCheck<T>(verify: (subject: T) => Promise<DdlCheckResult>) {
  const i18n = useI18n()
  const [held, setHeld] = useState<HeldDdl<T> | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<DdlCheckResult | null>(null)
  // A second click before the first check settles must not read twice (state updates lag a render).
  const running = useRef(false)
  const hold = (next: HeldDdl<T>) => { setResult(null); setCheckError(null); setHeld(next) }
  const check = async () => {
    if (!held || running.current) return
    running.current = true
    setChecking(true)
    setCheckError(null)
    try {
      setResult(await verify(held.subject))
      setHeld(null)
    } catch {
      setCheckError(i18n.t('核对没有完成，请稍后再试。'))
    } finally {
      running.current = false
      setChecking(false)
    }
  }
  return { held, checking, checkError, result, hold, check, clearResult: () => setResult(null) }
}

/** What the notice reads from `useDdlCheck` (any subject type). */
export interface DdlCheckView {
  readonly held: { readonly text: string; readonly details: string } | null
  readonly checking: boolean
  readonly checkError: string | null
  readonly result: DdlCheckResult | null
  readonly check: () => Promise<void>
}

/** The 「结果未知」 notice with its 「核对」 button, then the check's result. */
export function DdlCheckNotice({ controller, className }: { controller: DdlCheckView; className?: string }) {
  const i18n = useI18n()
  const { held, checking, checkError, result } = controller
  if (held) {
    return (
      <Alert variant="warning" className={className} data-ddl-unknown="">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{i18n.t('结果未知')}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{held.text}</p>
          {checkError ? <p role="alert">{checkError}</p> : null}
          {held.details ? <details className="text-xs"><summary className="cursor-pointer">{i18n.t('技术详情')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{held.details}</p></details> : null}
          <Button type="button" size="sm" variant="outline" disabled={checking} data-action="ddl-check" onClick={() => { void controller.check() }}>
            {checking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="mr-1 h-3.5 w-3.5" />}
            {checking ? i18n.t('正在核对…') : i18n.t('核对')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (result) {
    return (
      <Alert variant={result.applied === true ? 'success' : 'default'} className={className} role="status" data-ddl-check-result="">
        <CheckCircle className="h-4 w-4" />
        <AlertDescription>{result.text}</AlertDescription>
      </Alert>
    )
  }
  return null
}

/** The Host's own message under 「技术详情」, inside a confirmation that stayed open on an error. */
export function DdlErrorDetails({ details }: { details: string | null }) {
  const i18n = useI18n()
  if (!details) return null
  return <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t('技术详情')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{details}</p></details>
}
