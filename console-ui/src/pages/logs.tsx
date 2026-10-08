import { useEffect, useState, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../utils/auth'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { useToast } from '../components/toast'
import { ConfirmDialog } from '../components/confirm-dialog'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { readErrorSummary } from '../utils/read-error.mjs'
import { logReadState, logPayloadAvailability } from './logs/read-state.mjs'
import { isDemoMode } from '../utils/demo-mode'
import { LogWorkbench, type LogEntry, type LogStats } from './logs/LogWorkbench'

import { historyQuery, historyParams, changeHistoryFilter, isCurrentHistoryRequest, validateHistoryResponse, type HistoryPayload } from './logs/history-model.mjs'

const LOG_STATS_TIMEOUT_MS = 8_000

export default function LogsPage() {
  const readOnly = isDemoMode()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  const { success, error: toastError } = useToast()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = historyQuery(searchParams)
  const {level:levelFilter, q:textFilter, source:sourceFilter, page, pageSize} = query
  const requestKey = historyParams(query).toString()
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
      void fetchStats()
      await fetchLogs()
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
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        const availability = logPayloadAvailability(data)
        if (!availability.available) {
          setLogsLoaded(false)
          setError(availability.message)
          return
        }
        const result = validateHistoryResponse(data)
        setHistory(result)
        setLogs(result.data)
        loadedKeyRef.current = requestKey
        setLogsLoaded(true)
        setError(null)
        if (result.page !== page) {
          const next = new URLSearchParams(searchParamsRef.current)
          next.set('page',String(result.page))
          searchParamsRef.current = next
          setSearchParams(next,{replace:true})
        }
      } catch (err) {
        if (activeKeyRef.current !== requestKey || !isCurrentHistoryRequest(logsInFlightRef.current,controller,requestKey)) return
        setLogsLoaded(false)
        const message = err instanceof Error ? err.message : String(err)
        setError(message === 'Host 不支持日志历史分页' ? '当前 Host 不支持日志历史分页。请更新 Host 后重试；旧版仅支持最近日志的接口不能提供完整历史。' : readErrorSummary(message, '日志'))
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
        if (!res.ok) throw new Error(`日志统计暂时不可读 (HTTP ${res.status})`)
        const data = await res.json()
        if (!data.success) throw new Error('日志统计响应无效')
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller) {
          const availability = logPayloadAvailability(data)
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
          setStatsError(readErrorSummary(err instanceof Error ? err.message : err, '日志统计'))
        }
      } finally {
        if (statsInFlightRef.current?.controller === controller) statsInFlightRef.current = null
      }
    })()
    statsInFlightRef.current = { controller, promise }
    return promise
  }

  const changeFilter = (name: string, value: string | number) => {
    const next = changeHistoryFilter(searchParamsRef.current,name,value)
    searchParamsRef.current = next
    setSearchParams(next, {replace:true})
  }
  const selectLevel = (value:string) => changeFilter('level',value)
  const changeTextFilter = (value:string) => changeFilter('q',value)
  const changePage = (value:number) => {
    if(value > 1) setAutoScroll(false)
    const next = new URLSearchParams(searchParamsRef.current)
    next.set('page',String(value))
    searchParamsRef.current = next
    setSearchParams(next,{replace:true})
  }

  const invalidateLogReads = () => {
    logsInFlightRef.current?.controller.abort()
    logsInFlightRef.current = null
    statsInFlightRef.current?.controller.abort()
    statsInFlightRef.current = null
  }

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
      if (!res.ok) throw new Error('清空失败')
      const data = await res.json()
      if (data.success) {
        invalidateLogReads()
        setLogs([])
        void fetchLogs()
        void fetchStats()
        success('日志已清空')
      } else {
        throw new Error(data.error ?? '清空失败')
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
      if (!res.ok) throw new Error('清理失败')
      const data = await res.json()
      if (data.success) {
        invalidateLogReads()
        success(`成功清理 ${data.deletedCount} 条日志`)
        void fetchLogs()
        void fetchStats()
      } else throw new Error(data.error ?? '清理失败')
    } catch (err) {
      toastError((err as Error).message)
    }
  }

  return (
    <PageShell className="console-logs-page max-w-[1800px]">
      <PageHeader
        title="日志"
        description={readOnly ? '实时查看与筛选系统运行日志（Demo 只读）。' : '查看历史与实时日志，定位运行异常。'}
      />

      <LogWorkbench
        state={{ logs: loadedKeyRef.current === requestKey ? logs : [], stats, level: levelFilter, query: textFilter, autoScroll, error: error ?? statsError, readOnly, logsKnown: access.logsKnown, canManage: access.canManage, loading, source: sourceFilter, page, pageSize, total: history?.total ?? null, totalPages: history?.totalPages ?? null, sources: loadedKeyRef.current === requestKey ? history?.sources ?? [] : [] }}
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
        title="清空全部日志"
        description="此操作不可撤销，确定要清空全部日志吗？"
        variant="destructive"
        confirmLabel="清空"
        onConfirm={handleClearAllConfirm}
      />}
      {!readOnly && <ConfirmDialog
        open={cleanupConfirmOpen}
        onOpenChange={setCleanupConfirmOpen}
        title="清理旧日志"
        description={cleanupParams.days
          ? `确定清理 ${cleanupParams.days} 天前的日志吗？匹配的日志会永久删除，操作不可撤销。`
          : `确定只保留最近 ${cleanupParams.maxRecords} 条日志吗？其余日志会永久删除，操作不可撤销。`}
        variant="destructive"
        confirmLabel="清理"
        onConfirm={handleCleanupConfirm}
      />}
    </PageShell>
  )
}
