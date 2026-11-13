import type { ConsoleAccess } from '../../utils/console-access.mjs'
import type { LogPanelFilter } from './log-panel-store.mjs'

export const LOG_PANEL_ID: 'console-log-panel'
export const LOG_PANEL_STORAGE_KEY: string
export const LOG_PANEL_MIN_HEIGHT: number
export const LOG_PANEL_MAX_RATIO: number
export const LOG_PANEL_DEFAULT_HEIGHT: number
export const LOG_PANEL_KEY_STEP: number
export const LOG_PANEL_KEY_STEP_LARGE: number
export const LOG_PANEL_SHORTCUT_LABEL: string
export const LOG_FILTER_PARAMS: readonly string[]
export function sanitizeLogParams(params: URLSearchParams | string | null | undefined): URLSearchParams
export function logFilterParams(filter?: LogPanelFilter): URLSearchParams
export function hasLogFilter(filter?: LogPanelFilter | null): boolean
export function logPageHref(params: URLSearchParams | string): string
export function clampPanelHeight(height: number, viewportHeight?: number): number
export function panelHeightForKey(key: string, height: number, viewportHeight: number, shiftKey?: boolean): number | null
export function panelHeightForDrag(startHeight: number, startY: number, currentY: number, viewportHeight: number): number
export function isLogPanelShortcut(event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string; key?: string; isComposing?: boolean } | null | undefined): boolean
export function shouldCloseOnEscape(input: { key: string; defaultPrevented: boolean; focusInside: boolean }): boolean
export function logPanelAvailable(routes: readonly { path?: string; requiredPermissions?: readonly string[]; [key: string]: unknown }[] | null | undefined, access?: ConsoleAccess): boolean
export function logPanelSuspended(pathname: string): boolean
export function readLogPanelPrefs(storage: Pick<Storage, 'getItem'> | null | undefined): { height: number; params: string }
export function writeLogPanelPrefs(storage: Pick<Storage, 'setItem'> | null | undefined, prefs: { height: number; params: URLSearchParams | string }): boolean
