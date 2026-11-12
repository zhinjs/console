import { useEffect } from 'react'
import { useI18n } from '../../i18n'
import { StatusState } from '../../components/StatusState'
import { statusFromError } from '../../components/status-state-model.mjs'
import { reportInstanceReading } from '../../utils/instance-availability.mjs'
import { readErrorSummary } from '../../utils/read-error.mjs'

/**
 * Read failure of an instance-served 运维 page (数据库、配置文件、环境变量、项目文件) as one
 * `StatusState`: 实例不可用 / 数据库忙 / 内容已被修改 / 无权限 / 断连 / 读取失败. An instance failure
 * also wakes the shell's 实例不可用 banner, which these pages reach through the SDK transport
 * (not `apiFetch`), so the banner would not see it otherwise.
 */
export function OpsLoadState({ error, resource, onRetry, permissions, compact, className }: {
  /** The failure text (the SDK keeps the Host's message, e.g. "The Zhin instance is not running"). */
  error: string
  /** What failed to load, already translated (「数据库信息」). */
  resource: string
  onRetry?: () => void
  permissions?: readonly string[]
  compact?: boolean
  className?: string
}) {
  const i18n = useI18n()
  const reading = statusFromError(error)
  useEffect(() => { reportInstanceReading(statusFromError(error)) }, [error])
  const description = ['instance-unavailable', 'database-busy', 'error', 'forbidden'].includes(reading.kind)
    ? readErrorSummary(error, resource, i18n.locale)
    : undefined
  return <StatusState error={error} description={description} permissions={permissions} onRetry={onRetry} compact={compact} className={className} />
}
