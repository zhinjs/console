import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useConfirm } from '../components/confirm-dialog'
import { createBlockedNavigationHandler, installUnloadGuard, leavesCurrentPage } from './unsaved-changes-guard.mjs'

/**
 * While `active`, warn before refresh/close and confirm before leaving the page in-app:
 * link clicks, programmatic navigate() (e.g. the command palette) and browser back/forward
 * all go through the data router's `useBlocker`. Render the returned element to host the
 * confirmation dialog.
 */
export function useUnsavedChangesGuard(active: boolean) {
  const i18n = useI18n()
  const { confirm, ConfirmDialog } = useConfirm()
  const latest = useRef({ i18n, confirm })
  latest.current = { i18n, confirm }
  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
      active && leavesCurrentPage(currentLocation, nextLocation),
    [active],
  )
  const blocker = useBlocker(shouldBlock)
  const settle = useMemo(() => createBlockedNavigationHandler(() => latest.current.confirm({
    title: latest.current.i18n.t("放弃未保存的修改？"),
    description: latest.current.i18n.t("离开设置页后，尚未保存的配置修改将会丢失。"),
    confirmLabel: latest.current.i18n.t("放弃修改并离开"),
    variant: 'destructive',
  })), [])
  useEffect(() => { settle(blocker) }, [blocker, settle])
  useEffect(() => {
    if (!active) return
    return installUnloadGuard(window)
  }, [active])
  return ConfirmDialog
}
