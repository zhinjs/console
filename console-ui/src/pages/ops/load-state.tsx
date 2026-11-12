import { useI18n } from '../../i18n'
import { StatusState } from '../../components/StatusState'
import { statusFromError } from '../../components/status-state-model.mjs'
import { readErrorSummary } from '../../utils/read-error.mjs'

/**
 * Read failure of an instance-served 运维 page (数据库、配置文件、环境变量、项目文件) as one
 * `StatusState`: 实例不可用 / 数据库忙 / 内容已被修改 / 无权限 / 断连 / 读取失败. The shell's
 * 实例不可用 banner learns about instance failures from the transport itself (`observeHostGatewayReply`).
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
  const description = ['instance-unavailable', 'database-busy', 'error', 'forbidden'].includes(reading.kind)
    ? readErrorSummary(error, resource, i18n.locale)
    : undefined
  return <StatusState error={error} description={description} permissions={permissions} onRetry={onRetry} compact={compact} className={className} />
}
