import { AlertCircle, RefreshCw, Info } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'

export type ErrorAlertKind = 'none' | '404' | '503' | 'other'

interface ErrorAlertProps {
  error: string
  onRetry?: () => void
  className?: string
  kind?: ErrorAlertKind
}

function variantForKind(kind: ErrorAlertKind): 'destructive' | 'warning' | 'default' {
  if (kind === '503') return 'warning'
  if (kind === '404') return 'default'
  return 'destructive'
}

/**
 * 统一错误提示组件
 * - 标准化 Alert 样式 + 可选重试按钮
 * - 404 / 503 使用差异化样式
 */
export function ErrorAlert({ error, onRetry, className, kind = 'other' }: ErrorAlertProps) {
  const Icon = kind === '404' ? Info : AlertCircle
  return (
    <Alert variant={variantForKind(kind)} className={className}>
      <Icon className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-2">
        <span>{error}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
            <RefreshCw className="w-3 h-3 mr-1" />
            重试
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
