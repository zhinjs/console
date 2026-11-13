/**
 * 底部日志面板：纯函数（不读时钟、不碰 DOM / location）。面板与 /logs 页渲染同一个 LogViewer，
 * 筛选状态都是一组 URLSearchParams：/logs 页放在地址栏里，面板放在内存里（并记在 localStorage），
 * 所以面板从不改当前页面的地址。
 */
import { historyQuery } from '../../pages/logs/history-model.mjs'
import { canSeeRoute } from '../../navigation-sections.mjs'
import { CONSOLE_PATHS } from '../../console-routes.mjs'

export const LOG_PANEL_ID = 'console-log-panel'
export const LOG_PANEL_STORAGE_KEY = 'zhin.console.log-panel'
export const LOG_PANEL_MIN_HEIGHT = 180
export const LOG_PANEL_MAX_RATIO = 0.8
export const LOG_PANEL_DEFAULT_HEIGHT = 360
/** 方向键每次调整 24px，按住 Shift 或用 PageUp/PageDown 时 96px。 */
export const LOG_PANEL_KEY_STEP = 24
export const LOG_PANEL_KEY_STEP_LARGE = 96
/** Ctrl + `（与 VS Code 的面板一致；macOS 上 ⌘` 是系统切换窗口，所以两个平台都用 Ctrl）。 */
export const LOG_PANEL_SHORTCUT_LABEL = 'Ctrl `'

/** LogViewer 读写的查询参数：日志历史筛选 + 范围（scope-filter.mjs）。 */
export const LOG_FILTER_PARAMS = Object.freeze(['level', 'q', 'source', 'page', 'pageSize', 'adapter', 'endpoint', 'conversation'])

const text = value => typeof value === 'string' ? value.trim() : ''

/** 只保留日志筛选参数（去掉页签、其他页面的参数）。 */
export function sanitizeLogParams(params) {
  const source = params instanceof URLSearchParams ? params : new URLSearchParams(typeof params === 'string' ? params : '')
  const next = new URLSearchParams()
  for (const name of LOG_FILTER_PARAMS) {
    const value = source.get(name)
    if (value !== null && value !== '') next.set(name, value)
  }
  return next
}

/**
 * `openLogPanel({ q, adapter, endpoint, level, source, conversation })` 的筛选 → 参数。
 * 账号与会话要有上级（与 readScopeFilter 同口径），无效级别丢弃。
 */
export function logFilterParams(filter = {}) {
  const params = new URLSearchParams()
  const q = text(filter.q)
  const adapter = text(filter.adapter)
  const endpoint = adapter ? text(filter.endpoint) : ''
  const conversation = endpoint ? text(filter.conversation) : ''
  const source = text(filter.source)
  const level = text(filter.level)
  if (q) params.set('q', q)
  if (adapter) params.set('adapter', adapter)
  if (endpoint) params.set('endpoint', endpoint)
  if (conversation) params.set('conversation', conversation)
  if (source) params.set('source', source)
  if (['debug', 'info', 'warn', 'error'].includes(level)) params.set('level', level)
  return params
}

/** 筛选里是否带了任何条件（没有条件时打开面板沿用上一次的筛选）。 */
export function hasLogFilter(filter) {
  return !!filter && logFilterParams(filter).toString() !== ''
}

/** 「在日志页打开」：同一组筛选，从第一页开始。 */
export function logPageHref(params) {
  const next = sanitizeLogParams(params)
  next.delete('page')
  const search = next.toString()
  return search ? `${CONSOLE_PATHS.logs}?${search}` : CONSOLE_PATHS.logs
}

/** 面板高度：不小于 180px，不超过视口的 80%（视口太矮时以最小值为准）。 */
export function clampPanelHeight(height, viewportHeight) {
  const viewport = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 900
  const max = Math.max(LOG_PANEL_MIN_HEIGHT, Math.floor(viewport * LOG_PANEL_MAX_RATIO))
  const value = Number.isFinite(height) ? Math.round(height) : LOG_PANEL_DEFAULT_HEIGHT
  return Math.min(max, Math.max(LOG_PANEL_MIN_HEIGHT, value))
}

/**
 * 拖动条（role="separator"）的键盘调整：↑ / ↓ 调高调低，Shift 或 PageUp / PageDown 步长更大，
 * Home / End 到最小 / 最大。其他键返回 null（不处理，不 preventDefault）。
 */
export function panelHeightForKey(key, height, viewportHeight, shiftKey = false) {
  const step = shiftKey ? LOG_PANEL_KEY_STEP_LARGE : LOG_PANEL_KEY_STEP
  switch (key) {
    case 'ArrowUp': return clampPanelHeight(height + step, viewportHeight)
    case 'ArrowDown': return clampPanelHeight(height - step, viewportHeight)
    case 'PageUp': return clampPanelHeight(height + LOG_PANEL_KEY_STEP_LARGE, viewportHeight)
    case 'PageDown': return clampPanelHeight(height - LOG_PANEL_KEY_STEP_LARGE, viewportHeight)
    case 'Home': return clampPanelHeight(LOG_PANEL_MIN_HEIGHT, viewportHeight)
    case 'End': return clampPanelHeight(viewportHeight, viewportHeight)
    default: return null
  }
}

/** 拖动：指针从 startY 移到 currentY，面板在底部，往上拖变高。 */
export function panelHeightForDrag(startHeight, startY, currentY, viewportHeight) {
  return clampPanelHeight(startHeight + (startY - currentY), viewportHeight)
}

/** Ctrl + `（不带 ⌘ / Alt / Shift；输入法组字中不算）。 */
export function isLogPanelShortcut(event) {
  if (!event || event.isComposing) return false
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  return event.code === 'Backquote' || event.key === '`'
}

/**
 * Esc 只在焦点位于面板内、且没有内层弹层（Radix 菜单、选择框、确认框）先消费它时关闭面板。
 * Radix 弹层渲染在 portal 里：焦点在弹层时不算「在面板内」，它的 Esc 也会 preventDefault。
 */
export function shouldCloseOnEscape({ key, defaultPrevented, focusInside }) {
  return key === 'Escape' && !defaultPrevented && !!focusInside
}

/**
 * 面板只给能看 /logs 的身份（ROUTE_PERMISSIONS['/logs'] = status.view）：没有注册 /logs 路由、
 * 或身份看不到它时，按钮、快捷键、快速跳转里的动作和页面里的「查看日志」都不出现。
 */
export function logPanelAvailable(routes, access) {
  const route = (routes ?? []).find(item => item?.path === CONSOLE_PATHS.logs)
  return !!route && canSeeRoute(route, access)
}

/**
 * 面板在 /logs 页上不显示：页面已经在显示同一份日志，两个 LogViewer 同时轮询同一个接口没有意义。
 * 打开状态保留，离开 /logs 后面板回来。
 */
export function logPanelSuspended(pathname) {
  return pathname === CONSOLE_PATHS.logs || pathname === `${CONSOLE_PATHS.logs}/`
}

/** localStorage 里的面板偏好：上次的筛选与高度。读不到、被禁用或内容损坏时用默认值。 */
export function readLogPanelPrefs(storage) {
  const fallback = { height: LOG_PANEL_DEFAULT_HEIGHT, params: '' }
  try {
    const raw = storage?.getItem?.(LOG_PANEL_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const height = Number.isFinite(parsed?.height) ? Math.round(parsed.height) : LOG_PANEL_DEFAULT_HEIGHT
    const params = typeof parsed?.params === 'string' ? sanitizeLogParams(parsed.params).toString() : ''
    return { height: Math.max(LOG_PANEL_MIN_HEIGHT, height), params }
  } catch {
    return fallback
  }
}

/** 写入偏好；存储不可用（隐私模式、配额）时返回 false，面板照常工作。 */
export function writeLogPanelPrefs(storage, prefs) {
  try {
    if (!storage?.setItem) return false
    storage.setItem(LOG_PANEL_STORAGE_KEY, JSON.stringify({
      height: Math.round(prefs.height),
      params: sanitizeLogParams(prefs.params).toString(),
    }))
    return true
  } catch {
    return false
  }
}

/** 面板里显示的筛选摘要（标题旁）：级别 + 文本 + 范围。 */
export function logPanelFilterSummary(params) {
  const clean = sanitizeLogParams(params)
  const query = historyQuery(clean)
  const adapter = text(clean.get('adapter'))
  const endpoint = adapter ? text(clean.get('endpoint')) : ''
  const parts = []
  if (adapter) parts.push(endpoint ? `${adapter} / ${endpoint}` : adapter)
  if (query.q) parts.push(`“${query.q}”`)
  if (query.level !== 'all') parts.push(query.level)
  if (query.source) parts.push(query.source)
  return parts.join(' · ')
}
