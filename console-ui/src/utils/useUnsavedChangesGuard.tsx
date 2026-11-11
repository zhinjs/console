import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useConfirm } from '../components/confirm-dialog'
import { installUnsavedChangesGuard } from './unsaved-changes-guard.mjs'

/**
 * While `active`, warn before refresh/close and confirm before in-app link navigation.
 * The app uses BrowserRouter (not a data router), so `useBlocker` is unavailable; link
 * clicks are intercepted instead. Browser back/forward and programmatic navigate() calls
 * are not intercepted. Render the returned element to host the confirmation dialog.
 */
export function useUnsavedChangesGuard(active: boolean) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const { confirm, ConfirmDialog } = useConfirm()
  const latest = useRef({ i18n, navigate, confirm })
  latest.current = { i18n, navigate, confirm }
  useEffect(() => {
    if (!active) return
    return installUnsavedChangesGuard({
      view: window,
      navigate: path => latest.current.navigate(path),
      confirmLeave: () => latest.current.confirm({
        title: latest.current.i18n.t("放弃未保存的修改？"),
        description: latest.current.i18n.t("离开设置页后，尚未保存的配置修改将会丢失。"),
        confirmLabel: latest.current.i18n.t("放弃修改并离开"),
        variant: 'destructive',
      }),
    })
  }, [active])
  return ConfirmDialog
}
