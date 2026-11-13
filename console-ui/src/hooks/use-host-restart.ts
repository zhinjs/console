import { useEffect, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n'
import { CONSOLE_RPC } from '../contracts/zhin-console'
import { GATEWAY_INSTANCE_RPC } from '../contracts/gateway'
import { requestConsole } from '../utils/console-rpc'
import { getConsoleTransport } from '../utils/console-client'
import { probeInstance } from '../utils/instance-availability.mjs'
import { outcomeUnknown, statusFromError } from '../components/status-state-model.mjs'
import { createRestartTracker } from '../components/restart-tracker.mjs'
import { restartInProgress } from '../components/apply-outcome-model.mjs'
import type { RestartState } from '../components/apply-outcome-model.mjs'

type Confirm = (options: {
  title: string
  description?: string
  confirmLabel?: string
  variant?: 'default' | 'destructive'
}) => Promise<boolean>

/**
 * The one Host restart of this page load: `system:restart`, then wait until the instance answers
 * again (gateway run facts changed, or seen down and answering again), up to RESTART_TIMEOUT_MS.
 * Every surface that offers a restart (立即重启 after a save, 首页, 环境变量) shows this progress.
 */
export const hostRestart = createRestartTracker({
  request: () => requestConsole({ type: CONSOLE_RPC.SYSTEM_RESTART }),
  readStatus: () => requestConsole({ type: GATEWAY_INSTANCE_RPC.STATUS }),
  probe: () => probeInstance(requestConsole),
  isConnected: () => getConsoleTransport().isConnected(),
  // Without a trustworthy answer the restart may have been sent: wait and see instead of failing.
  mayHaveRun: error => outcomeUnknown(statusFromError(error)),
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: id => window.clearTimeout(id as number),
})

/** Live restart progress; the event stream's reconnects speed up the check. */
export function useHostRestartProgress(): RestartState {
  const state = useSyncExternalStore(hostRestart.subscribe, hostRestart.get, hostRestart.get)
  const waiting = state.phase === 'waiting'
  useEffect(() => {
    if (!waiting) return
    let transport: ReturnType<typeof getConsoleTransport>
    try { transport = getConsoleTransport() } catch { return }
    return transport.onConnectionChange(connected => hostRestart.nudge(connected))
  }, [waiting])
  return state
}

/**
 * 重启 on 首页 and 环境变量: confirm, then start the shared restart. Pages render
 * `<RestartProgress />` (ApplyFeedback) next to the button to show its progress.
 */
export function useHostRestart(confirm: Confirm) {
  const i18n = useI18n()
  const state = useHostRestartProgress()

  const confirmRestart = async () => {
    if (restartInProgress(hostRestart.get())) return
    const ok = await confirm({
      title: i18n.t("重启 Zhin 服务"),
      description: i18n.t("所有连接将断开，进行中的对话可能被中止。通过 zhin runtime start 启动的前台和 daemon 服务会自动重新启动；--once 模式不会自动恢复。若使用自定义启动器，请确认其重启机制。"),
      confirmLabel: i18n.t("确认重启"),
      variant: 'destructive',
    })
    if (ok) await hostRestart.start()
  }

  return { restarting: restartInProgress(state), confirmRestart }
}
