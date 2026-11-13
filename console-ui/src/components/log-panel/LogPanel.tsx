import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowUpRight, Filter, PanelBottom, SquareArrowOutUpRight, X } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Button } from '../ui/button'
import { LogViewer } from '../../pages/logs/LogViewer'
import { clearScopeFilter, readScopeFilter, scopeObjectHref } from '../../pages/insights/scope-filter.mjs'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { app } from '../../utils/console-client'
import { closeLogPanel, logPanelStore, openLogPanel, toggleLogPanel, type LogPanelFilter, type LogPanelState } from './log-panel-store.mjs'
import {
  clampPanelHeight,
  isLogPanelShortcut,
  logPageHref,
  logPanelAvailable,
  logPanelSuspended,
  LOG_PANEL_ID,
  LOG_PANEL_MIN_HEIGHT,
  LOG_PANEL_SHORTCUT_LABEL,
  panelHeightForDrag,
  panelHeightForKey,
  readLogPanelPrefs,
  shouldCloseOnEscape,
  writeLogPanelPrefs,
} from './log-panel-model.mjs'
import './log-panel.css'

export { openLogPanel, closeLogPanel, toggleLogPanel, type LogPanelFilter }

/** Reserved space below the page while the docked panel is open (shell.css / toast.css read it). */
const RESERVE_VAR = '--console-log-panel-reserve'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function useLogPanelState(): LogPanelState {
  return useSyncExternalStore(logPanelStore.subscribe, logPanelStore.get, logPanelStore.get)
}

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => typeof window === 'undefined' ? 900 : window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

/** Whether this principal may use the log panel: the same rule as the /logs page (status.view). */
export function useLogPanelAvailable(): boolean {
  const routes = useSyncExternalStore(app.subscribe, () => app.getRoutes(), () => app.getRoutes())
  const access = useConsoleAccess()
  return useMemo(() => logPanelAvailable(routes, access), [routes, access])
}

/**
 * Pages use this to deep-link into the panel: `const logs = useLogPanel(); logs.available &&
 * <Button onClick={() => logs.open({ adapter, endpoint })}>查看日志</Button>`.
 */
export function useLogPanel() {
  const available = useLogPanelAvailable()
  const state = useLogPanelState()
  return { available, isOpen: state.open, open: openLogPanel, close: closeLogPanel, toggle: toggleLogPanel }
}

/** What the shell needs: whether the phone sheet is open (it is modal there, so the page goes inert). */
export function useLogPanelLayout(): { visible: boolean; modal: boolean } {
  const location = useLocation()
  const available = useLogPanelAvailable()
  const mobile = useIsMobile()
  const state = useLogPanelState()
  const visible = available && state.open && !logPanelSuspended(location.pathname)
  return { visible, modal: visible && mobile }
}

/** Top-bar toggle (icon + tooltip). Hidden for principals who cannot see /logs. */
export function LogPanelButton() {
  const i18n = useI18n()
  const location = useLocation()
  const available = useLogPanelAvailable()
  const state = useLogPanelState()
  if (!available) return null
  const onLogsPage = logPanelSuspended(location.pathname)
  const expanded = state.open && !onLogsPage
  const label = onLogsPage ? i18n.t('当前页面就是运行日志') : expanded ? i18n.t('关闭日志面板') : i18n.t('打开日志面板')
  return (
    <button
      type="button"
      className={cn('console-icon-button console-log-panel-trigger', expanded && 'is-active')}
      title={onLogsPage ? label : `${label}（${LOG_PANEL_SHORTCUT_LABEL}）`}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={LOG_PANEL_ID}
      aria-keyshortcuts="Control+`"
      disabled={onLogsPage}
      onClick={() => { toggleLogPanel() }}
    >
      <PanelBottom aria-hidden="true" />
    </button>
  )
}

/**
 * 底部日志面板：外壳挂一次，任何页面都能打开（顶栏按钮、Ctrl + `、快速跳转、`openLogPanel(filter)`）。
 * 渲染与 /logs 页相同的 LogViewer，筛选放在面板自己的状态里，不改当前地址。
 *
 * - 宽屏停靠在底部、占满内容宽度、非模态：没有遮罩，页面不 inert，没有焦点陷阱；页面底部让出面板高度。
 * - 打开时焦点移到面板，关闭时回到打开它的控件（焦点已被用户移到页面别处时不抢）。
 * - Esc 只在焦点位于面板内、且内层弹层没有先消费它时关闭。
 * - 上边缘拖动条（也可用键盘）调整高度：180px 到视口 80%，记在 localStorage。
 * - 窄屏（<768px）是底部抽屉，模态（遮罩 + 页面 inert）。
 * - 只在打开时挂载 LogViewer，关闭即停止轮询；在 /logs 页上不显示（页面已在轮询同一份日志）。
 */
export function LogPanel() {
  const i18n = useI18n()
  const location = useLocation()
  const available = useLogPanelAvailable()
  const mobile = useIsMobile()
  const viewportHeight = useViewportHeight()
  const state = useLogPanelState()
  const suspended = logPanelSuspended(location.pathname)
  const visible = available && state.open && !suspended
  const panelRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const hydratedRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const height = clampPanelHeight(dragHeight ?? state.height, viewportHeight)
  const params = useMemo(() => new URLSearchParams(state.params), [state.params])
  // The range is the chip in the header (the /logs page shows the full range bar instead).
  const scopeFilter = readScopeFilter(params)

  // Last filters and height come back from localStorage, unless a page already opened the panel with a filter.
  useEffect(() => {
    if (logPanelStore.get().revision === 0) logPanelStore.hydrate(readLogPanelPrefs(browserStorage()))
    hydratedRef.current = true
  }, [])
  useEffect(() => {
    if (hydratedRef.current) writeLogPanelPrefs(browserStorage(), { height: state.height, params: state.params })
  }, [state.height, state.params])

  // Ctrl + ` toggles the panel from anywhere (not on /logs, which already shows the logs).
  useEffect(() => {
    if (!available) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isLogPanelShortcut(event) || logPanelSuspended(window.location.pathname)) return
      event.preventDefault()
      toggleLogPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [available])

  // Focus moves into the panel on open (and on every openLogPanel while open) and returns to the opener on close.
  useLayoutEffect(() => {
    if (!visible) return
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && typeof active.focus === 'function' && !panelRef.current?.contains(active)) openerRef.current = active
    panelRef.current?.focus({ preventScroll: true })
  }, [visible, state.revision])
  useEffect(() => {
    if (!visible) return
    return () => {
      const active = document.activeElement
      const focusLost = !active || active === document.body || !active.isConnected
      const opener = openerRef.current
      openerRef.current = null
      // Only give focus back when it was in the panel (now gone); never pull it away from where the user went.
      if (focusLost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [visible])

  // Escape closes only from inside the panel and only when no inner layer (menu, select, dialog) consumed it.
  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const focusInside = !!panelRef.current && panelRef.current.contains(document.activeElement)
      if (shouldCloseOnEscape({ key: event.key, defaultPrevented: event.defaultPrevented, focusInside })) {
        event.preventDefault()
        closeLogPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible])

  // The docked panel reserves its height below the page so the last rows stay reachable; the phone sheet is modal.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (!visible || mobile) {
      root.style.removeProperty(RESERVE_VAR)
      return
    }
    root.style.setProperty(RESERVE_VAR, `${height}px`)
  }, [visible, mobile, height])
  useEffect(() => () => { document.documentElement.style.removeProperty(RESERVE_VAR) }, [])
  useEffect(() => {
    if (!visible || !mobile) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [visible, mobile])

  if (!visible) return null

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = panelHeightForKey(event.key, height, viewportHeight, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    logPanelStore.setHeight(next, viewportHeight)
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height }
    setDragHeight(height)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setDragHeight(panelHeightForDrag(drag.startHeight, drag.startY, event.clientY, viewportHeight))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    logPanelStore.setHeight(panelHeightForDrag(drag.startHeight, drag.startY, event.clientY, viewportHeight), viewportHeight)
    setDragHeight(null)
  }

  const maxHeight = clampPanelHeight(viewportHeight, viewportHeight)
  const title = i18n.t('运行日志')
  return (
    <>
      {mobile ? <div className="console-log-panel-scrim" aria-hidden="true" onClick={() => closeLogPanel()} /> : null}
      <section
        id={LOG_PANEL_ID}
        ref={panelRef}
        className={cn('console-log-panel', mobile ? 'is-sheet' : 'is-docked', dragHeight !== null && 'is-resizing')}
        style={mobile ? undefined : { height }}
        tabIndex={-1}
        role={mobile ? 'dialog' : 'region'}
        aria-modal={mobile ? true : undefined}
        aria-label={i18n.t('底部日志面板')}
      >
        {mobile ? null : (
          <div
            className="console-log-panel-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label={i18n.t('调整日志面板高度')}
            aria-controls={LOG_PANEL_ID}
            aria-valuenow={height}
            aria-valuemin={LOG_PANEL_MIN_HEIGHT}
            aria-valuemax={maxHeight}
            aria-valuetext={i18n.t('{0} 像素', [height])}
            title={i18n.t('拖动或用 ↑ / ↓ 调整高度')}
            tabIndex={0}
            onKeyDown={onResizeKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
        <header className="console-log-panel-header">
          <div className="console-log-panel-title">
            <PanelBottom aria-hidden="true" />
            <h2>{title}</h2>
            {scopeFilter.active ? (
              <span className="console-log-panel-scope" title={i18n.t("运行日志没有结构化的适配器、账号或会话字段，这里按文本匹配这些标识，可能漏掉或多出条目；页码与总数按 Host 的文本条件统计，本页只显示匹配全部标识的行。")}>
                <Filter aria-hidden="true" />
                <code>{scopeFilter.identity}</code>
                <Link className="console-log-panel-chip-button" to={scopeObjectHref(scopeFilter.scope)} aria-label={i18n.t('打开对象页')} title={i18n.t('打开对象页')}><SquareArrowOutUpRight aria-hidden="true" /></Link>
                <button type="button" className="console-log-panel-chip-button" aria-label={i18n.t('清除范围')} title={i18n.t('清除范围')}
                  onClick={() => { logPanelStore.setParams(clearScopeFilter(params)) }}><X aria-hidden="true" /></button>
              </span>
            ) : <span className="console-log-panel-hint">{i18n.t('不离开当前页面查看实时日志')}</span>}
          </div>
          <div className="console-log-panel-actions">
            <Button asChild variant="ghost" size="sm" className="console-log-panel-open-page">
              <Link to={logPageHref(params)} onClick={() => closeLogPanel()} title={i18n.t('在日志页打开')}><span className="console-log-panel-open-label">{i18n.t('在日志页打开')}</span><ArrowUpRight aria-hidden="true" /></Link>
            </Button>
            <Button variant="ghost" size="icon" className="console-log-panel-tool" aria-label={i18n.t('关闭日志面板')} title={`${i18n.t('关闭日志面板')}（Esc）`} onClick={() => closeLogPanel()}>
              <X />
            </Button>
          </div>
        </header>
        <div className="console-log-panel-body">
          <LogViewer variant="panel" params={params} onParamsChange={next => { logPanelStore.setParams(next) }} />
        </div>
      </section>
    </>
  )
}
