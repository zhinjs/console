import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@zhin.js/console-ui'
import { useI18n } from '../i18n'
import { SAVED_HOLD_MS, saveButtonPhase } from './save-feedback-model.mjs'
import './save-button.css'

/** 已保存 for SAVED_HOLD_MS after `markSaved()`; `reset()` drops it early (e.g. a new edit). */
export function useSaveFeedback() {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const markSaved = useCallback(() => {
    clearTimeout(timer.current)
    setSaved(true)
    timer.current = setTimeout(() => setSaved(false), SAVED_HOLD_MS)
  }, [])
  const reset = useCallback(() => {
    clearTimeout(timer.current)
    setSaved(false)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { saved, markSaved, reset }
}

type SaveButtonProps = ComponentProps<typeof Button> & {
  saving: boolean
  saved: boolean
  /** Shown with the spinner while saving; 保存中… by default. */
  savingLabel?: ReactNode
}

/**
 * A save button that reports its own result (console#125): 保存中… → ✓ 已保存 (1.5 s) → its label.
 * Failures stay with the page's error alert; the button simply returns to its label.
 * Saving is the view's next step, so it is the component library's `primary` button by default
 * (ADR 0063 D25: at most one per view); pass `variant` where the view already has its primary.
 */
export function SaveButton({ saving, saved, savingLabel, children, className, variant = 'primary', ...props }: SaveButtonProps) {
  const i18n = useI18n()
  const phase = saveButtonPhase({ saving, saved })
  return <>
    <Button {...props} variant={variant} className={['console-save-button', className].filter(Boolean).join(' ')} data-save-phase={phase} aria-busy={phase === 'saving' || undefined}>
      {phase === 'saving' ? <><Loader2 className="animate-spin" aria-hidden="true" />{savingLabel ?? i18n.t('保存中…')}</>
        : phase === 'saved' ? <><Check className="console-save-check" aria-hidden="true" />{i18n.t('已保存')}</>
          : children}
    </Button>
    <span className="sr-only" role="status" aria-live="polite">{phase === 'saved' ? i18n.t('已保存') : ''}</span>
  </>
}
