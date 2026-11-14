import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { SIDE_EVENT_PUSH } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { translate, type Locale } from '../../i18n/locale.mjs'
import { CONSOLE_REST } from '../../contracts/zhin-console'
import { startVisiblePolling } from '../../hooks/visible-polling.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { useConsoleSession } from '../../hooks/use-console-session'
import { apiFetch, getApiBase, probeHealth } from '../../utils/auth'
import { getConsoleTransport } from '../../utils/console-client'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { onInstanceRecovered } from '../../utils/instance-availability.mjs'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { summarizeOptional } from '../dashboard-health'
import { logPayloadAvailability } from '../logs/read-state.mjs'
import {
  ATTENTION_NOT_READY_REFRESH_MS,
  ATTENTION_PUSH_DEBOUNCE_MS,
  ATTENTION_REFRESH_MS,
  attentionBadgeCount,
  attentionStorageKey,
  createDebouncer,
  emptyAttentionPrefs,
  ignoreAttention,
  loadAttention,
  partitionAttention,
  pruneAttentionPrefs,
  readAttentionPrefs,
  restoreAttention,
  samePrefs,
  snoozeAttention,
  writeAttentionPrefs,
  type AttentionFallbackInput,
  type AttentionItem,
  type AttentionLoad,
  type AttentionPrefs,
} from './attention-model.mjs'

export interface AttentionState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly data: AttentionLoad | null
  readonly error: unknown
  /** A background refresh is running (the last result stays on screen). */
  readonly refreshing: boolean
}

const FALLBACK_TIMEOUT_MS = 8_000
/** Push events after which the list may have changed (accounts, login challenges, requests). */
const PUSH_EVENTS = [
  SIDE_EVENT_PUSH.ENDPOINT_LIFECYCLE,
  SIDE_EVENT_PUSH.LOGIN_PENDING,
  SIDE_EVENT_PUSH.LOGIN_EXPIRED,
  SIDE_EVENT_PUSH.REQUEST_RECEIVE,
] as const

// ---------------------------------------------------------------- the one shared read

let state: AttentionState = { status: 'idle', data: null, error: null, refreshing: false }
let locale: Locale = 'zh-CN'
let sequence = 0
let subscribers = 0
let stop: (() => void) | null = null
/** One-shot sooner re-read while the instance is still starting. */
let notReadyTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function setState(next: AttentionState): void {
  state = next
  for (const listener of listeners) listener()
}

async function readJson(path: string, signal: AbortSignal): Promise<{ ok: boolean; body: any; status: number }> {
  const response = await apiFetch(path, { signal })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, body, status: response.status }
}

/** The dashboard reads the older derivation is built from. */
async function loadFallbackInput(currentLocale: Locale): Promise<AttentionFallbackInput> {
  const signal = AbortSignal.timeout(FALLBACK_TIMEOUT_MS)
  const [stats, logs, mcp] = await Promise.all([
    readJson(CONSOLE_REST.STATS, signal).catch(() => null),
    readJson(CONSOLE_REST.LOGS_STATS, signal).catch(() => null),
    readJson(`${CONSOLE_REST.INTROSPECTION}/mcp?page=1&pageSize=100`, signal).catch(() => null),
  ])
  const statsData = stats?.ok && stats.body?.success ? stats.body.data : null
  let logReadError: string | null = null
  let logData: unknown = null
  const label = translate(currentLocale, '日志统计')
  if (!logs) logReadError = readErrorSummary('network', label, currentLocale)
  else if (!logs.ok || logs.body?.success !== true) logReadError = readErrorSummary(logs.body?.error ?? `HTTP ${logs.status}`, label, currentLocale)
  else {
    const availability = logPayloadAvailability(logs.body, currentLocale)
    if (availability.available) logData = logs.body.data
    else logReadError = availability.message
  }
  const counts = summarizeOptional(logData, null)
  const mcpData = mcp?.ok && mcp.body?.success !== false ? mcp.body?.data : null
  const rows = Array.isArray(mcpData?.items) ? mcpData.items as Array<{ connected?: unknown }> : []
  return {
    stats: statsData,
    hostError: statsData ? null : 'unreachable',
    errorLogs: counts.errorLogs,
    warningLogs: counts.warningLogs,
    logReadError,
    mcpServices: typeof mcpData?.total === 'number' ? mcpData.total : null,
    connectedMcp: rows.filter(row => row.connected === true).length,
  }
}

/** The gateway's `/pub/health` `instance`; null when it cannot be read or says nothing. */
async function readInstanceHealth(currentLocale: Locale): Promise<unknown> {
  const health = await probeHealth(getApiBase(), currentLocale)
  return health.ok ? health.instance ?? null : null
}

function clearNotReadyTimer(): void {
  if (notReadyTimer !== null) clearTimeout(notReadyTimer)
  notReadyTimer = null
}

/** While the instance is not ready, read again sooner than the 30 s poll (until it is). */
function scheduleNotReadyRefresh(data: AttentionLoad): void {
  clearNotReadyTimer()
  if (data.mode !== 'instance-not-ready' || subscribers === 0) return
  notReadyTimer = setTimeout(() => { notReadyTimer = null; void refreshAttention() }, ATTENTION_NOT_READY_REFRESH_MS)
}

/** Re-reads the list; a newer call supersedes an older one still in flight. */
export function refreshAttention(): Promise<void> {
  if (!hasConsolePermission('status.view')) {
    setState({ status: 'idle', data: null, error: null, refreshing: false })
    return Promise.resolve()
  }
  clearNotReadyTimer()
  const ticket = ++sequence
  const currentLocale = locale
  setState(state.data ? { ...state, refreshing: true } : { ...state, status: 'loading', refreshing: true })
  return loadAttention({
    request: request => requestConsole(request),
    loadFallback: () => loadFallbackInput(currentLocale),
    readInstanceHealth: () => readInstanceHealth(currentLocale),
    locale: currentLocale,
  }).then(
    data => {
      if (ticket !== sequence) return
      setState({ status: 'ready', data, error: null, refreshing: false })
      scheduleNotReadyRefresh(data)
    },
    error => {
      if (ticket !== sequence) return
      // A failed refresh keeps the last list but reports the failure.
      setState({ status: state.data ? 'ready' : 'error', data: state.data, error, refreshing: false })
    },
  )
}

function start(): () => void {
  const debounced = createDebouncer(() => { void refreshAttention() }, ATTENTION_PUSH_DEBOUNCE_MS)
  void refreshAttention()
  // Every 30 s while visible, and once when the tab becomes visible again.
  const stopPolling = startVisiblePolling(() => { void refreshAttention() }, ATTENTION_REFRESH_MS)
  const onFocus = () => debounced.trigger()
  window.addEventListener('focus', onFocus)
  const transport = getConsoleTransport()
  const offPush = PUSH_EVENTS.map(type => transport.onConsoleEvent(type, () => debounced.trigger()))
  const offGap = transport.onConsoleEventRecoveryGap(() => debounced.trigger())
  const offRecovered = onInstanceRecovered(() => debounced.trigger())
  return () => {
    debounced.cancel()
    stopPolling()
    window.removeEventListener('focus', onFocus)
    for (const off of offPush) off()
    offGap()
    offRecovered()
    clearNotReadyTimer()
    sequence += 1
  }
}

/** Starts the shared refresh (first subscriber) and stops it with the last one. */
export function subscribeAttention(listener: () => void): () => void {
  listeners.add(listener)
  if (subscribers++ === 0) stop = start()
  return () => {
    listeners.delete(listener)
    if (--subscribers === 0) { stop?.(); stop = null }
  }
}

export function getAttentionState(): AttentionState {
  return state
}

function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  if (subscribers > 0) void refreshAttention()
}

// ---------------------------------------------------------------- per-viewer choices

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

let prefsKey = ''
let prefs: AttentionPrefs = emptyAttentionPrefs()
const prefListeners = new Set<() => void>()

function usePrefsKey(key: string): void {
  if (key === prefsKey) return
  prefsKey = key
  prefs = readAttentionPrefs(storage(), key)
}

function setPrefs(next: AttentionPrefs): void {
  prefs = next
  writeAttentionPrefs(storage(), prefsKey, next)
  for (const listener of prefListeners) listener()
}

function subscribePrefs(listener: () => void): () => void {
  prefListeners.add(listener)
  return () => { prefListeners.delete(listener) }
}

// ---------------------------------------------------------------- hook

export interface UseAttention {
  readonly state: AttentionState
  /** Whether the caller may read `attention.list` (status.view). */
  readonly allowed: boolean
  readonly active: readonly AttentionItem[]
  readonly snoozed: readonly AttentionItem[]
  readonly ignored: readonly AttentionItem[]
  readonly badgeCount: number
  /** The instance is not running and ready yet: the list is not readable, which is not an error. */
  readonly instanceNotReady: boolean
  refresh(): void
  snooze(item: AttentionItem): void
  ignore(item: AttentionItem): void
  restore(id: string): void
}

/** The shared attention list (one poller for the dashboard, the page and the top bar badge). */
export function useAttention(): UseAttention {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const session = useConsoleSession()
  const allowed = hasConsolePermission('status.view', access)
  usePrefsKey(attentionStorageKey(getApiBase(), session.me?.user?.id ?? null))
  useEffect(() => { setLocale(i18n.locale) }, [i18n.locale])
  // Access arrives after sign-in: read again once the permission is known.
  useEffect(() => { if (allowed && subscribers > 0) void refreshAttention() }, [allowed])
  const current = useSyncExternalStore(subscribeAttention, getAttentionState, getAttentionState)
  const viewerPrefs = useSyncExternalStore(subscribePrefs, () => prefs, () => prefs)
  const items = current.data?.items
  useEffect(() => {
    if (!items) return
    const pruned = pruneAttentionPrefs(prefs, items)
    if (!samePrefs(pruned, prefs)) setPrefs(pruned)
  }, [items])
  const parts = useMemo(() => partitionAttention(items ?? [], viewerPrefs), [items, viewerPrefs])
  const refresh = useCallback(() => { void refreshAttention() }, [])
  const snooze = useCallback((item: AttentionItem) => setPrefs(snoozeAttention(prefs, item)), [])
  const ignore = useCallback((item: AttentionItem) => setPrefs(ignoreAttention(prefs, item)), [])
  const restore = useCallback((id: string) => setPrefs(restoreAttention(prefs, id)), [])
  return {
    state: current,
    allowed,
    ...parts,
    badgeCount: allowed ? attentionBadgeCount(parts.active) : 0,
    instanceNotReady: current.data?.mode === 'instance-not-ready',
    refresh,
    snooze,
    ignore,
    restore,
  }
}
