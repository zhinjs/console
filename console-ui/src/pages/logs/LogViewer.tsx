import { useI18n } from '../../i18n'
import { useEffect, useState, useRef, useMemo } from 'react'
import { apiFetch } from '../../utils/auth'
import { useToast } from '../../components/toast'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { CONSOLE_REST } from '../../contracts/zhin-console'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { logReadState, logPayloadAvailability } from './read-state.mjs'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { LogWorkbench, type LogEntry, type LogStats } from './LogWorkbench'
import { ScopeFilterBar } from '../insights/ScopeFilterBar'
import { clearScopeFilter, logScopeTokens, logServerQuery, matchesLogScope, readScopeFilter } from '../insights/scope-filter.mjs'

import { historyQuery, historyParams, changeHistoryFilter, isCurrentHistoryRequest, validateHistoryResponse, type HistoryPayload } from './history-model.mjs'

const LOG_STATS_TIMEOUT_MS = 8_000

export interface LogViewerProps {
  /**
   * 筛选与分页（`level` / `q` / `source` / `page` / `pageSize` 与范围 `adapter` / `endpoint` / `conversation`）。
   * /logs 页传地址栏的 searchParams；底部日志面板传它自己的内存状态，不碰地址栏。
   */
  params: URLSearchParams
  /** 新的筛选；调用方决定写到哪（/logs 页 `setSearchParams(next, { replace: true })`）。 */
  onParamsChange(next: URLSearchParams): void
  /** `panel`：底部面板里的紧凑排版（不显示概况卡片，列表填满面板高度）。 */
  variant?: 'page' | 'panel'
}

/**
 * 运行日志查看器：/logs 页与底部日志面板共用。筛选状态由外部控制（params + onParamsChange），
 * 读取、轮询、清理与确认框在这里。只在挂载期间轮询：面板关闭即卸载，轮询随之停止。
 */
export function LogViewer({ params, onParamsChange, variant = 'page' }: LogViewerProps) {
  const i18n = useI18n()
  // Clearing logs is a host operation; viewers only read.
  const readOnly = !hasConsolePermission('ops.config.write')
  const paramsRef = useRef(params)
  paramsRef.current = params
  const onParamsChangeRef = useRef(onParamsChange)
  onParamsChangeRef.current = onParamsChange
  const commitParams = (next: URLSearchParams) => {
    paramsRef.current = next
    onParamsChangeRef.current(next)
  }
  const { success, error: toastError } = useToast()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = historyQuery(params)
  const {level:levelFilter, q:textFilter, source:sourceFilter, page, pageSize} = query
  // 范围（adapter / endpoint / conversation，来自对象页「记录」页签）：日志没有结构化字段，
  // Host 只接受一个文本条件，其余标识在本页再按文本收窄。
  const scopeFilter = readScopeFilter(params)
  const scopeTokens = useMemo(() => logScopeTokens(scopeFilter.scope), [scopeFilter.identity]) // eslint-disable-line react-hooks/exhaustive-deps
  const requestKey = historyParams({ ...query, q: logServerQuery(textFilter, scopeFilter.scope) }).toString()
  const activeKeyRef = useRef(requestKey)
  activeKeyRef.current = requestKey
  const [history, setHistory] = useState<HistoryPayload | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsInFlightRef = useRef<{
    key: string
    controller: AbortController
    promise: Promise<void>
  } | null>(null)
  const statsInFlightRef = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null)
  const prevLogSnapshotRef = useRef('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [cleanupParams, setCleanupParams] = useState<{ days?: number; maxRecords?: number }>({})

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      // A hidden tab keeps the timer but skips refreshes (visible-polling.mjs does the same); a new filter still loads once.
      if (document.visibilityState !== 'hidden' || loadedKeyRef.current !== requestKey) {
        void fetchStats()
        await fetchLogs()
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 3000)
    }
    setLoading(true)
    setLogsLoaded(false)
    void poll()
    return () => {
      cancelled = true
      logsInFlightRef.current?.controller.abort()
      logsInFlightRef.current = null
      statsInFlightRef.current?.controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [requestKey])

  const logSnapshot = useMemo(() => logs.map((log) => (
    `${log.timestamp}\u0000${log.level}\u0000${log.source}\u0000${log.message}`
  )).join('\u0001'), [logs])

  useEffect(() => {
    if (autoScroll && page === 1 && logSnapshot && logSnapshot !== prevLogSnapshotRef.current) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    prevLogSnapshotRef.current = logSnapshot
  }, [autoScroll, page, logSnapshot])

  const fetchLogs = (): Promise<void> => {
    const existing = logsInFlightRef.current
    if (existing?.key === requestKey) return existing.promise
    existing?.controller.abort()
    const controller = new AbortController()
    const promise = (async () => {
      try {
        const url = `${CONSOLE_REST.LOGS}?${requestKey}`
        const res = await apiFetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (activeKeyRef.current !== requestKey || !isCurrentHistoryRequest(logsInFlightRef.current,controller,requestKey)) return
        const availability = logPayloadAvailability(data, i18n.locale)
        if (!availability.available) {
          setLogsLoaded(false)
          setError(availability.message)
          return
        }
        const result = validateHistoryResponse(data, i18n.locale)
        setHistory(result)
        setLogs(result.data)
        loadedKeyRef.current = requestKey
        setLogsLoaded(true)
        setError(null)
        if (result.page !== page) {
          const next = new URLSearchParams(paramsRef.current)
          next.set('page',String(result.page))
          commitParams(next)
        }
      } catch (err) {
        if (activeKeyRef.current !== requestKey || !isCurrentHistoryRequest(logsInFlightRef.current,controller,requestKey)) return
        setLogsLoaded(false)
        const message = err instanceof Error ? err.message : String(err)
        setError(message === i18n.t("Host 不支持日志历史分页") ? i18n.t("当前 Host 不支持日志历史分页。请更新 Host 后重试；旧版仅支持最近日志的接口不能提供完整历史。") : readErrorSummary(message, i18n.t("日志"), i18n.locale))
      } finally {
        if (logsInFlightRef.current?.controller === controller) {
          logsInFlightRef.current = null
          setLoading(false)
        }
      }
    })()
    logsInFlightRef.current = { key: requestKey, controller, promise }
    return promise
  }

  const fetchStats = (): Promise<void> => {
    if (statsInFlightRef.current) return statsInFlightRef.current.promise
    const controller = new AbortController()
    const promise = (async () => {
      try {
        const res = await apiFetch(CONSOLE_REST.LOGS_STATS, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(LOG_STATS_TIMEOUT_MS),
          ]),
        })
        if (!res.ok) throw new Error(i18n.t("日志统计暂时不可读 (HTTP {0})", [res.status]))
        const data = await res.json()
        if (!data.success) throw new Error(i18n.t("日志统计响应无效"))
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller) {
          const availability = logPayloadAvailability(data, i18n.locale)
          if (!availability.available) {
            setStats(null)
            setStatsError(availability.message)
            return
          }
        }
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller) {
          setStats(data.data)
          setStatsError(null)
        }
      } catch (err) {
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller) {
          setStats(null)
          setStatsError(readErrorSummary(err instanceof Error ? err.message : err, i18n.t("日志统计"), i18n.locale))
        }
      } finally {
        if (statsInFlightRef.current?.controller === controller) statsInFlightRef.current = null
      }
    })()
    statsInFlightRef.current = { controller, promise }
    return promise
  }

  const changeFilter = (name: string, value: string | number) => {
    commitParams(changeHistoryFilter(paramsRef.current,name,value))
  }
  const selectLevel = (value:string) => changeFilter('level',value)
  const changeTextFilter = (value:string) => changeFilter('q',value)
  const changePage = (value:number) => {
    if(value > 1) setAutoScroll(false)
    const next = new URLSearchParams(paramsRef.current)
    next.set('page',String(value))
    commitParams(next)
  }

  const invalidateLogReads = () => {
    logsInFlightRef.current?.controller.abort()
    logsInFlightRef.current = null
    statsInFlightRef.current?.controller.abort()
    statsInFlightRef.current = null
  }

  const scopedLogs = scopeTokens.length ? logs.filter(log => matchesLogScope(log, scopeTokens)) : logs

  const access = logReadState({ readOnly, loaded: logsLoaded && loadedKeyRef.current === requestKey, error, statsError, stats })

  const handleClearAll = async () => {
    if (!access.canManage) return
    setClearConfirmOpen(true)
  }

  const handleClearAllConfirm = async () => {
    if (!access.canManage) return
    invalidateLogReads()
    try {
      const res = await apiFetch(CONSOLE_REST.LOGS, { method: 'DELETE' })
      if (!res.ok) throw new Error(i18n.t("清空失败"))
      const data = await res.json()
      if (data.success) {
        invalidateLogReads()
        setLogs([])
        void fetchLogs()
        void fetchStats()
        success(i18n.t("日志已清空"))
      } else {
        throw new Error(data.error ?? i18n.t("清空失败"))
      }
    } catch (err) {
      toastError((err as Error).message)
    }
  }

  const handleCleanup = async (days?: number, maxRecords?: number) => {
    if (!access.canManage) return
    setCleanupParams({ days, maxRecords })
    setCleanupConfirmOpen(true)
  }

  const handleCleanupConfirm = async () => {
    if (!access.canManage) return
    const { days, maxRecords } = cleanupParams
    invalidateLogReads()
    try {
      const res = await apiFetch(CONSOLE_REST.LOGS_CLEANUP, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, maxRecords })
      })
      if (!res.ok) throw new Error(i18n.t("清理失败"))
      const data = await res.json()
      if (data.success) {
        invalidateLogReads()
        success(i18n.t("成功清理 {0} 条日志", [data.deletedCount]))
        void fetchLogs()
        void fetchStats()
      } else throw new Error(data.error ?? i18n.t("清理失败"))
    } catch (err) {
      toastError((err as Error).message)
    }
  }

  return (
    <>
      <ScopeFilterBar
        filter={scopeFilter}
        onClear={() => commitParams(clearScopeFilter(paramsRef.current))}
        note={i18n.t("运行日志没有结构化的适配器、账号或会话字段，这里按文本匹配这些标识，可能漏掉或多出条目；页码与总数按 Host 的文本条件统计，本页只显示匹配全部标识的行。")}
      />

      <LogWorkbench
        compact={variant === 'panel'}
        state={{ logs: loadedKeyRef.current === requestKey ? scopedLogs : [], stats, level: levelFilter, query: textFilter, autoScroll, error: error ?? statsError, readOnly, logsKnown: access.logsKnown, canManage: access.canManage, loading, source: sourceFilter, page, pageSize, total: history?.total ?? null, totalPages: history?.totalPages ?? null, sources: loadedKeyRef.current === requestKey ? history?.sources ?? [] : [] }}
        actions={{
          selectLevel,
          selectSource: value => changeFilter('source',value),
          changePage,
          changePageSize: value => changeFilter('pageSize',value),
          changeQuery: changeTextFilter,
          changeAutoScroll: enabled => { setAutoScroll(enabled); if(enabled) changePage(1) },
          refresh: () => { void fetchLogs(); void fetchStats() },
          retry: () => { void fetchLogs() },
          clearAll: () => { void handleClearAll() },
          cleanup: (days, maxRecords) => { void handleCleanup(days, maxRecords) },
        }}
        endRef={logsEndRef}
      />

      {!readOnly && <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={i18n.t("清空全部日志")}
        description={i18n.t("此操作不可撤销，确定要清空全部日志吗？")}
        variant="destructive"
        confirmLabel={i18n.t("清空")}
        onConfirm={handleClearAllConfirm}
      />}
      {!readOnly && <ConfirmDialog
        open={cleanupConfirmOpen}
        onOpenChange={setCleanupConfirmOpen}
        title={i18n.t("清理旧日志")}
        description={cleanupParams.days
          ? i18n.t("确定清理 {0} 天前的日志吗？匹配的日志会永久删除，操作不可撤销。", [cleanupParams.days])
          : i18n.t("确定只保留最近 {0} 条日志吗？其余日志会永久删除，操作不可撤销。", [cleanupParams.maxRecords])}
        variant="destructive"
        confirmLabel={i18n.t("清理")}
        onConfirm={handleCleanupConfirm}
      />}
    </>
  )
}
