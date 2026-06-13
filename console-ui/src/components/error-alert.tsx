import { AlertCircle, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'

interface ErrorAlertProps {
  error: string
  onRetry?: () => void
  className?: string
}

/**
 * 统一错误提示组件
 * - 标准化 Alert 样式 + 可选重试按钮
 */
export function ErrorAlert({ error, onRetry, className }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
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
