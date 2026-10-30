import { useI18n } from '../i18n'
import { useState, useCallback, type ReactNode } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from './ui/dialog'
import { Button } from './ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open, onOpenChange, title, description, children,
  confirmLabel, cancelLabel,
  variant = 'default', onConfirm,
}: ConfirmDialogProps) {
  const i18n = useI18n()
  const [loading, setLoading] = useState(false)

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [onConfirm, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm">{cancelLabel ?? i18n.t('取消')}</Button>
          </DialogClose>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? i18n.t("处理中...") : (confirmLabel ?? i18n.t('确认'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Hook for imperative confirm dialogs.
 * Usage:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: '确定删除？', variant: 'destructive' })) { ... }
 */
export function useConfirm() {
  const [state, setState] = useState<{
    resolve: (v: boolean) => void
    opts: Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'>
  } | null>(null)

  const confirm = useCallback((opts: Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'>) => {
    return new Promise<boolean>(resolve => {
      setState({ resolve, opts })
    })
  }, [])

  const ConfirmDialogElement = state ? (
    <ConfirmDialog
      open
      onOpenChange={open => {
        if (!open) {
          state.resolve(false)
          setState(null)
        }
      }}
      onConfirm={() => {
        state.resolve(true)
        setState(null)
      }}
      {...state.opts}
    />
  ) : null

  return { confirm, ConfirmDialog: ConfirmDialogElement }
}
