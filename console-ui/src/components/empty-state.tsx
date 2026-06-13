import type { LucideIcon } from 'lucide-react'
import { cn } from '@zhin.js/client'

interface EmptyStateProps {
  icon?: LucideIcon
  title?: string
  description?: string
  className?: string
  /** 嵌入表格/卡片内时使用更紧凑的样式 */
  compact?: boolean
}

/**
 * 统一空状态组件
 * - 标准化图标大小（w-12 h-12）、透明度（opacity-30）、间距
 * - compact 模式用于表格行/卡片内嵌场景
 */
export function EmptyState({ icon: Icon, title, description, className, compact }: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn('flex flex-col items-center gap-2 py-8 text-center', className)}>
        {Icon && <Icon className="w-8 h-8 text-muted-foreground opacity-30" />}
        <p className="text-sm text-muted-foreground">{title || '暂无数据'}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col items-center gap-3 py-12 text-center', className)}>
      {Icon && <Icon className="w-12 h-12 text-muted-foreground opacity-30" />}
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <p className="text-sm text-muted-foreground max-w-sm">{description || '暂无数据'}</p>
    </div>
  )
}
