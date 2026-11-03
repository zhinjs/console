import { useI18n } from '../i18n'
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { appendToast, toastDuration } from './toast-policy.mjs'
import './toast.css'

export interface Toast {
  id: string
  title?: string
  description: string
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
  /** Zero keeps a notification visible until dismissed or replaced by newer feedback. */
  duration?: number
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (description: string, title?: string) => void
  error: (description: string, title?: string) => void
  warning: (description: string, title?: string) => void
  info: (description: string, title?: string) => void
}

type PauseReason = 'pointer' | 'focus'
interface ToastTimer { remaining: number; startedAt: number; pausedBy: Set<PauseReason>; timeout?: ReturnType<typeof setTimeout> }

const ToastContext = createContext<ToastContextValue | null>(null)
const VARIANT_ICONS = { default: Info, success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info }

export function ToastProvider({ children }: { children: ReactNode }) {
  const i18n = useI18n()
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)
  const timers = useRef(new Map<string, ToastTimer>())

  const remove = useCallback((id: string) => {
    clearTimeout(timers.current.get(id)?.timeout)
    timers.current.delete(id)
    setToasts(previous => previous.filter(toast => toast.id !== id))
  }, [])

  const resume = useCallback((id: string, reason?: PauseReason) => {
    const timer = timers.current.get(id)
    if (!timer) return
    if (reason) timer.pausedBy.delete(reason)
    if (timer.pausedBy.size > 0 || timer.timeout !== undefined) return
    timer.startedAt = Date.now()
    timer.timeout = setTimeout(() => remove(id), timer.remaining)
  }, [remove])

  const pause = useCallback((id: string, reason: PauseReason) => {
    const timer = timers.current.get(id)
    if (!timer) return
    timer.pausedBy.add(reason)
    if (timer.timeout === undefined) return
    clearTimeout(timer.timeout)
    timer.timeout = undefined
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt))
  }, [])

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `toast-${++counterRef.current}`
    const notification: Toast = { ...opts, id, variant: opts.variant ?? 'default', duration: toastDuration(opts.variant, opts.duration) }
    setToasts(previous => appendToast(previous, notification))
    if (notification.duration && notification.duration > 0) {
      timers.current.set(id, { remaining: notification.duration, startedAt: 0, pausedBy: new Set() })
      resume(id)
    }
    return id
  }, [resume])

  useEffect(() => {
    const visible = new Set(toasts.map(toast => toast.id))
    for (const [id, timer] of timers.current) if (!visible.has(id)) {
      clearTimeout(timer.timeout)
      timers.current.delete(id)
    }
  }, [toasts])

  useEffect(() => {
    const reset = () => {
      for (const timer of timers.current.values()) clearTimeout(timer.timeout)
      timers.current.clear()
      setToasts([])
    }
    window.addEventListener('zhin:auth-required', reset)
    window.addEventListener('zhin:api-base-changed', reset)
    const ownedTimers = timers.current
    return () => {
      window.removeEventListener('zhin:auth-required', reset)
      window.removeEventListener('zhin:api-base-changed', reset)
      for (const timer of ownedTimers.values()) clearTimeout(timer.timeout)
      ownedTimers.clear()
    }
  }, [])

  const success = useCallback((description: string, title?: string) => { toast({ description, title, variant: 'success' }) }, [toast])
  const error = useCallback((description: string, title?: string) => { toast({ description, title, variant: 'error' }) }, [toast])
  const warning = useCallback((description: string, title?: string) => { toast({ description, title, variant: 'warning' }) }, [toast])
  const info = useCallback((description: string, title?: string) => { toast({ description, title, variant: 'info' }) }, [toast])

  return <ToastContext.Provider value={{ toast, success, error, warning, info }}>
    {children}
    <div className="console-toast-stack">
      {toasts.map(notification => {
        const variant = notification.variant ?? 'default'
        const Icon = VARIANT_ICONS[variant]
        return <div key={notification.id} className={`console-toast console-toast-${variant}`}
          role={variant === 'error' ? 'alert' : 'status'} aria-atomic="true"
          onMouseEnter={() => pause(notification.id, 'pointer')} onMouseLeave={() => resume(notification.id, 'pointer')}
          onFocusCapture={() => pause(notification.id, 'focus')} onBlurCapture={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(notification.id, 'focus')
          }}>
          <span className="console-toast-icon" aria-hidden="true"><Icon /></span>
          <div className="console-toast-copy">{notification.title && <strong>{notification.title}</strong>}<p>{notification.description}</p></div>
          <button type="button" className="console-toast-close" onClick={() => remove(notification.id)} aria-label={i18n.t('关闭通知')}><X /></button>
        </div>
      })}
    </div>
  </ToastContext.Provider>
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}
