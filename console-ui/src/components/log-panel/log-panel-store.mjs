/**
 * 底部日志面板的模块级状态：外壳挂一次 `<LogPanel>`，任何页面用 `openLogPanel({ q, adapter, endpoint, level })`
 * 打开它并带上筛选。状态只在内存里（偏好由 LogPanel 写进 localStorage），从不改 location。
 */
import { clampPanelHeight, hasLogFilter, logFilterParams, LOG_PANEL_DEFAULT_HEIGHT, sanitizeLogParams } from './log-panel-model.mjs'

/** `{ open, params, height, revision }`；revision 每次 openLogPanel 都加一（已打开时也重新聚焦）。 */
export function createLogPanelStore(initial = {}) {
  let state = Object.freeze({
    open: false,
    params: sanitizeLogParams(initial.params ?? '').toString(),
    height: Number.isFinite(initial.height) ? Math.round(initial.height) : LOG_PANEL_DEFAULT_HEIGHT,
    revision: 0,
  })
  const listeners = new Set()
  const set = patch => {
    const next = Object.freeze({ ...state, ...patch })
    if (Object.keys(next).every(key => next[key] === state[key])) return state
    state = next
    for (const listener of [...listeners]) listener()
    return state
  }
  const open = filter => set({
    open: true,
    revision: state.revision + 1,
    ...(hasLogFilter(filter) ? { params: logFilterParams(filter).toString() } : {}),
  })
  return Object.freeze({
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** 带筛选时替换面板筛选（从第一页开始）；不带时沿用上一次的筛选。 */
    open,
    close: () => set({ open: false }),
    toggle: filter => state.open ? set({ open: false }) : open(filter),
    setParams: params => set({ params: sanitizeLogParams(params).toString() }),
    setHeight: (height, viewportHeight) => set({ height: clampPanelHeight(height, viewportHeight) }),
    /** 读到 localStorage 偏好后恢复（只在启动时调用一次，不打开面板）。 */
    hydrate(prefs) {
      return set({
        params: sanitizeLogParams(prefs?.params ?? '').toString(),
        ...(Number.isFinite(prefs?.height) ? { height: Math.round(prefs.height) } : {}),
      })
    },
  })
}

export const logPanelStore = createLogPanelStore()

/** 打开底部日志面板；`filter` 可带 `q` / `adapter` / `endpoint` / `level`（以及 `source` / `conversation`）。 */
export function openLogPanel(filter) {
  return logPanelStore.open(filter)
}

export function closeLogPanel() {
  return logPanelStore.close()
}

export function toggleLogPanel(filter) {
  return logPanelStore.toggle(filter)
}
