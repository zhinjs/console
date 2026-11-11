import { useState } from 'react'
import { useI18n } from '../i18n'
import { useToast } from '../components/toast'
import { CONSOLE_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'

type Confirm = (options: {
  title: string
  description?: string
  confirmLabel?: string
  variant?: 'default' | 'destructive'
}) => Promise<boolean>

/**
 * The single Console flow for restarting the Host: confirm, send `system:restart`, then reload
 * once the Host has had time to come back. Pages pass the `confirm` from their `useConfirm()`.
 */
export function useHostRestart(confirm: Confirm) {
  const i18n = useI18n()
  const { success, error: toastError } = useToast()
  const [restarting, setRestarting] = useState(false)

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.SYSTEM_RESTART })
      success(i18n.t("重启请求已发送，连接将在服务恢复后自动重连"))
      window.setTimeout(() => window.location.reload(), 3000)
    } catch {
      toastError(i18n.t("重启请求未能发送"))
      setRestarting(false)
    }
  }

  const confirmRestart = async () => {
    const ok = await confirm({
      title: i18n.t("重启 Zhin 服务"),
      description: i18n.t("所有连接将断开，进行中的对话可能被中止。通过 zhin runtime start 启动的前台和 daemon 服务会自动重新启动；--once 模式不会自动恢复。若使用自定义启动器，请确认其重启机制。"),
      confirmLabel: i18n.t("确认重启"),
      variant: 'destructive',
    })
    if (ok) await handleRestart()
  }

  return { restarting, confirmRestart }
}
