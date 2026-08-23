import { useEffect, useState, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../utils/auth'
import { Skeleton } from '../components/ui/skeleton'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { useToast } from '../components/toast'
import { ConfirmDialog } from '../components/confirm-dialog'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { isDemoMode } from '../utils/demo-mode'
import { LogWorkbench, type LogEntry, type LogStats } from './logs/LogWorkbench'

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
  const [error, setError] = useState<string | null>(null)
  const requestedLevel = searchParams.get('level')
  const levelFilter = requestedLevel === 'info' || requestedLevel === 'warn' || requestedLevel === 'error'
    || requestedLevel === 'debug'
    ? requestedLevel
    : 'all'
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsInFlightRef = useRef<{
    level: string
    controller: AbortController
    promise: Promise<void>
  } | null>(null)
  const statsInFlightRef = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null)
  const prevLogSnapshotRef = useRef('')
  const textFilter = searchParams.get('q') ?? ''
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [cleanupParams, setCleanupParams] = useState<{ days?: number; maxRecords?: number }>({})

  const filteredLogs = useMemo(() => {
    const q = textFilter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q),
    )
  }, [logs, textFilter])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      void fetchStats()
      await fetchLogs()
      if (!cancelled) timer = window.setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      cancelled = true
      logsInFlightRef.current?.controller.abort()
      logsInFlightRef.current = null
      statsInFlightRef.current?.controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [levelFilter])

  const logSnapshot = useMemo(() => logs.map((log) => (
    `${log.timestamp}\u0000${log.level}\u0000${log.source}\u0000${log.message}`
  )).join('\u0001'), [logs])

  useEffect(() => {
    if (autoScroll && logSnapshot && logSnapshot !== prevLogSnapshotRef.current) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLogSnapshotRef.current = logSnapshot
  }, [autoScroll, logSnapshot])

  const fetchLogs = (): Promise<void> => {
    const existing = logsInFlightRef.current
    if (existing?.level === levelFilter) return existing.promise
    existing?.controller.abort()
    const controller = new AbortController()
    const promise = (async () => {
      try {
        const url = levelFilter === 'all' ? `${CONSOLE_REST.LOGS}?limit=100` : `${CONSOLE_REST.LOGS}?limit=100&level=${levelFilter}`
        const res = await apiFetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error('API 请求失败')
        const data = await res.json()
        if (controller.signal.aborted || logsInFlightRef.current?.controller !== controller) return
        if (data.success && Array.isArray(data.data)) { setLogs(data.data.reverse()); setError(null) }
      } catch (err) {
        if (controller.signal.aborted || logsInFlightRef.current?.controller !== controller) return
        setError((err as Error).message)
      } finally {
        if (logsInFlightRef.current?.controller === controller) {
          logsInFlightRef.current = null
          setLoading(false)
        }
      }
    })()
    logsInFlightRef.current = { level: levelFilter, controller, promise }
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
        if (!res.ok) return
        const data = await res.json()
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller && data.success) {
          setStats(data.data)
        }
      } catch (err) {
        if (!controller.signal.aborted && statsInFlightRef.current?.controller === controller) {
          console.error('Failed to fetch stats:', err)
        }
      } finally {
        if (statsInFlightRef.current?.controller === controller) statsInFlightRef.current = null
      }
    })()
    statsInFlightRef.current = { controller, promise }
    return promise
  }

  const selectLevel = (level: string) => {
    const next = new URLSearchParams(searchParamsRef.current)
    if (level === 'all') next.delete('level')
    else next.set('level', level)
    searchParamsRef.current = next
    setSearchParams(next, { replace: true })
  }

  const changeTextFilter = (query: string) => {
    const next = new URLSearchParams(searchParamsRef.current)
    if (query) next.set('q', query)
    else next.delete('q')
    searchParamsRef.current = next
    setSearchParams(next, { replace: true })
  }

  const invalidateLogReads = () => {
    logsInFlightRef.current?.controller.abort()
    logsInFlightRef.current = null
    statsInFlightRef.current?.controller.abort()
    statsInFlightRef.current = null
  }

  const handleClearAll = async () => {
    setClearConfirmOpen(true)
  }

  const handleClearAllConfirm = async () => {
    invalidateLogReads()
    try {
      const res = await apiFetch(CONSOLE_REST.LOGS, { method: 'DELETE' })
      if (!res.ok) throw new Error('清空失败')
      const data = await res.json()
      if (data.success) {
        invalidateLogReads()
        setLogs([])
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
    setCleanupParams({ days, maxRecords })
    setCleanupConfirmOpen(true)
  }

  const handleCleanupConfirm = async () => {
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

  if (loading) {
    return (
      <PageShell>
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-96" />
      </PageShell>
    )
  }

  return (
    <PageShell className="max-w-[1800px]">
      <PageHeader
        title="日志"
        description={readOnly ? '实时查看与筛选系统运行日志（Demo 只读）。' : '实时查看与筛选系统运行日志；支持按级别与关键字过滤。'}
      />

      <LogWorkbench
        state={{ logs: filteredLogs, stats, level: levelFilter, query: textFilter, autoScroll, error, readOnly }}
        actions={{
          selectLevel,
          changeQuery: changeTextFilter,
          changeAutoScroll: setAutoScroll,
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
          ? `确定清理 ${cleanupParams.days} 天前的日志吗？`
          : `确定只保留最近 ${cleanupParams.maxRecords} 条日志吗？`}
        variant="destructive"
        confirmLabel="清理"
        onConfirm={handleCleanupConfirm}
      />}
    </PageShell>
  )
}
