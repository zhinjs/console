export interface LogPanelFilter {
  q?: string
  adapter?: string
  endpoint?: string
  conversation?: string
  level?: 'debug' | 'info' | 'warn' | 'error' | string
  source?: string
}
export interface LogPanelState {
  readonly open: boolean
  /** URLSearchParams string of the panel's own filters (never the page URL). */
  readonly params: string
  readonly height: number
  readonly revision: number
}
export interface LogPanelStore {
  get(): LogPanelState
  subscribe(listener: () => void): () => void
  open(filter?: LogPanelFilter): LogPanelState
  close(): LogPanelState
  toggle(filter?: LogPanelFilter): LogPanelState
  setParams(params: URLSearchParams | string): LogPanelState
  setHeight(height: number, viewportHeight?: number): LogPanelState
  hydrate(prefs: { params?: string; height?: number }): LogPanelState
}
export function createLogPanelStore(initial?: { params?: string; height?: number }): LogPanelStore
export const logPanelStore: LogPanelStore
export function openLogPanel(filter?: LogPanelFilter): LogPanelState
export function closeLogPanel(): LogPanelState
export function toggleLogPanel(filter?: LogPanelFilter): LogPanelState
