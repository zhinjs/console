import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@zhin.js/client'

export interface Toast {
  id: string
  title?: string
  description: string
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
  duration?: number
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (description: string, title?: string) => void
  error: (description: string, title?: string) => void
  warning: (description: string, title?: string) => void
  info: (description: string, title?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_STYLES: Record<string, string> = {
  default: 'border bg-background text-foreground',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100',
}

const VARIANT_ICONS: Record<string, typeof CheckCircle> = {
  default: Info,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `toast-${++counterRef.current}`
    const t: Toast = { id, variant: 'default', duration: 3000, ...opts }
    setToasts(prev => [...prev, t])
    setTimeout(() => remove(id), t.duration)
    return id
  }, [remove])

  const success = useCallback((description: string, title?: string) => {
    toast({ description, title, variant: 'success' })
  }, [toast])

  const error = useCallback((description: string, title?: string) => {
    toast({ description, title, variant: 'error', duration: 5000 })
  }, [toast])

  const warning = useCallback((description: string, title?: string) => {
    toast({ description, title, variant: 'warning', duration: 4000 })
  }, [toast])

  const info = useCallback((description: string, title?: string) => {
    toast({ description, title, variant: 'info' })
  }, [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none" role="status" aria-live="polite">
        {toasts.map(t => {
          const Icon = VARIANT_ICONS[t.variant || 'default']
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto rounded-lg border p-3 shadow-lg animate-in slide-in-from-bottom-5 fade-in duration-300',
                VARIANT_STYLES[t.variant || 'default'],
              )}
            >
              <div className="flex items-start gap-2">
                <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  {t.title && <p className="text-sm font-medium">{t.title}</p>}
                  <p className="text-sm opacity-90">{t.description}</p>
                </div>
                <button
                  className="shrink-0 h-5 w-5 rounded flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  onClick={() => remove(t.id)}
                  aria-label="关闭通知"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
