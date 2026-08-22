import { useEffect, useState, useCallback } from 'react'
import { Clock, Plus, Trash2, AlertCircle, Pause, Play, RefreshCw, Timer, Cpu, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Separator } from '../components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'
import { useToast } from '../components/toast'
import { PageHeader } from '../components/PageHeader'
import { CONSOLE_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'
import { isDemoMode } from '../utils/demo-mode'

interface MemoryCron {
  type: 'memory'
  expression: string
  running: boolean
  nextExecution?: number | null
  plugin?: string
}

interface PersistentCron {
  type: 'persistent'
  id: string
  cronExpression: string
  prompt: string
  label?: string
  enabled: boolean
  createdAt?: number
}

export default function CronPage() {
  const [memoryCrons, setMemoryCrons] = useState<MemoryCron[]>([])
  const [persistentCrons, setPersistentCrons] = useState<PersistentCron[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PersistentCron | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newCron, setNewCron] = useState({ cronExpression: '', prompt: '', label: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedMemIdx, setExpandedMemIdx] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const { error: toastError } = useToast()
  const readOnly = isDemoMode()

  const fetchCrons = useCallback(async () => {
    try {
      type ScheduleListResponse = {
        memory?: MemoryCron[]
        persistent?: PersistentCron[]
      }
      const data = await requestConsole<ScheduleListResponse>({ type: CONSOLE_RPC.SCHEDULE_LIST })
      setMemoryCrons(data.memory ?? [])
      setPersistentCrons(data.persistent ?? [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void fetchCrons()
  }, [fetchCrons])

  const handleAdd = async () => {
    if (!newCron.cronExpression || !newCron.prompt) return
    setSubmitting(true)
    try {
      await requestConsole({
        type: CONSOLE_RPC.CRON_ADD,
        cronExpression: newCron.cronExpression,
        prompt: newCron.prompt,
        label: newCron.label,
      })
      setAddDialogOpen(false)
      setNewCron({ cronExpression: '', prompt: '', label: '' })
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.CRON_REMOVE, id: deleteTarget.id })
      setDeleteTarget(null)
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (job: PersistentCron) => {
    try {
      if (job.enabled) {
        await requestConsole({ type: CONSOLE_RPC.CRON_PAUSE, id: job.id })
      } else {
        await requestConsole({ type: CONSOLE_RPC.CRON_RESUME, id: job.id })
      }
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchCrons() }}>
          <RefreshCw className="w-4 h-4 mr-1" /> 重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="定时任务"
        description="管理持久化和内存定时任务"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchCrons() }}>
              <RefreshCw className="w-4 h-4 mr-1" /> 刷新
            </Button>
            {!readOnly && (
              <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> 新建任务
              </Button>
            )}
          </div>
        }
      />

      {/* Persistent Cron Jobs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Timer className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">持久化任务</h3>
          <Badge variant="secondary">{persistentCrons.length}</Badge>
        </div>
        {persistentCrons.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>暂无持久化定时任务</p>
              <p className="text-xs mt-1">
                {readOnly ? 'Demo 仅展示实例中已存在的任务' : '点击「新建任务」添加一个定时 AI 任务'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {persistentCrons.map((job) => {
              const isExpanded = expandedId === job.id
              return (
              <Card key={job.id} className={!job.enabled ? 'opacity-60' : ''}>
                <CardContent className="py-4">
                  <div
                    className="flex items-start justify-between gap-4 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                        <span className="font-medium truncate">
                          {job.label || job.id}
                        </span>
                        <Badge variant={job.enabled ? 'default' : 'outline'} className="text-xs shrink-0">
                          {job.enabled ? '运行中' : '已暂停'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2 ml-6">
                        <code className="bg-muted px-1.5 py-0.5 rounded break-all">{job.cronExpression}</code>
                        <span className="shrink-0">创建于 {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</span>
                      </div>
                      {!isExpanded && (
                        <p className="text-sm text-muted-foreground line-clamp-1 ml-6">{job.prompt}</p>
                      )}
                    </div>
                    {!readOnly && <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={job.enabled ? '暂停' : '恢复'}
                        onClick={() => handleToggle(job)}
                      >
                        {job.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="删除"
                        onClick={() => setDeleteTarget(job)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-3 border-t pt-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">任务 ID</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="复制 ID"
                            onClick={() => {
                              navigator.clipboard.writeText(job.id)
                              setCopiedId(job.id)
                              setTimeout(() => setCopiedId(null), 1500)
                            }}
                          >
                            {copiedId === job.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                        <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{job.id}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Cron 表达式</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block break-all">{job.cronExpression}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Prompt</span>
                        <pre className="text-sm bg-muted px-3 py-2 rounded whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{job.prompt}</pre>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">状态: {job.enabled ? <Badge variant="default" className="text-xs">运行中</Badge> : <Badge variant="secondary" className="text-xs">已暂停</Badge>}</span>
                        <span>创建于: {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Memory Cron Jobs (read-only) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">内存任务（插件注册）</h3>
          <Badge variant="outline">{memoryCrons.length}</Badge>
        </div>
        {memoryCrons.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              暂无插件注册的内存定时任务
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {memoryCrons.map((cron, idx) => {
              const isExpanded = expandedMemIdx === idx
              return (
              <Card key={idx} className={!cron.running ? 'opacity-60' : ''}>
                <CardContent className="py-3">
                  <div
                    className="flex items-center justify-between mb-1 cursor-pointer"
                    onClick={() => setExpandedMemIdx(isExpanded ? null : idx)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{cron.expression}</code>
                    </div>
                    <Badge variant={cron.running ? 'default' : 'outline'} className="text-xs">
                      {cron.running ? '运行中' : '已停止'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5 ml-6">
                    <p>插件: {cron.plugin}</p>
                    {cron.nextExecution && (
                      <p>下次执行: {new Date(cron.nextExecution).toLocaleString()}</p>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-2 border-t pt-3">
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Cron 表达式</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">{cron.expression}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">所属插件</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">{cron.plugin}</code>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">状态: {cron.running ? <Badge variant="default" className="text-xs">运行中</Badge> : <Badge variant="outline" className="text-xs">已停止</Badge>}</span>
                        {cron.nextExecution && (
                          <span>下次执行: {new Date(cron.nextExecution).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Dialog */}
      {!readOnly && <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建定时任务</DialogTitle>
            <DialogDescription>
              创建一个持久化定时任务，到点时会将 Prompt 发送给 AI 执行。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">标签（可选）</label>
              <Input
                placeholder="例如：每日摘要"
                value={newCron.label}
                onChange={(e) => setNewCron((p) => ({ ...p, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Cron 表达式</label>
              <Input
                placeholder="分 时 日 月 周，例如：0 9 * * *"
                value={newCron.cronExpression}
                onChange={(e) => setNewCron((p) => ({ ...p, cronExpression: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                5 字段格式：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7)
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Prompt</label>
              <Textarea
                placeholder="触发时发送给 AI 的指令..."
                rows={4}
                value={newCron.prompt}
                onChange={(e) => setNewCron((p) => ({ ...p, prompt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button
              onClick={handleAdd}
              disabled={submitting || !newCron.cronExpression || !newCron.prompt}
            >
              {submitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* Delete Confirm Dialog */}
      {!readOnly && <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除任务「{deleteTarget?.label || deleteTarget?.id}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
