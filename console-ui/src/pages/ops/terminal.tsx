import { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, ClipboardPaste, Eraser, Plus, RefreshCw, RotateCcw, ShieldAlert, SquareTerminal, Unplug, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { SelectField } from '../../components/ui/select'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import { apiFetch, getApiBase } from '../../utils/auth'
import { copyText } from '../clipboard-copy.mjs'
import type { TerminalTarget } from '../../contracts/gateway'
import {
  createTerminalConnection, readTerminalTargets, terminalHttpError, terminalNeedsConfirmation, terminalPaths, terminalSocketUrl,
  type TerminalConnection, type TerminalEnd, type TerminalSocketLike,
} from './terminal-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

const PATHS = terminalPaths('/api')

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

async function fetchTargets(t: Translate): Promise<TerminalTarget[]> {
  const response = await apiFetch(PATHS.targets)
  const body = await readJson(response)
  if (!response.ok) {
    const failure = terminalHttpError(response.status, body, t)
    throw Object.assign(new Error(failure.message), { kind: failure.kind })
  }
  return readTerminalTargets((body as { data?: unknown } | null)?.data ?? body)
}

/** One-time ticket for the WebSocket (browsers cannot send Authorization on an upgrade). */
async function requestTicket(target: string, cols: number, rows: number, t: Translate): Promise<{ ticket: string }> {
  const response = await apiFetch(PATHS.tickets, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, cols, rows }),
  })
  const body = await readJson(response) as { data?: { ticket?: unknown } } | null
  if (!response.ok) throw new Error(terminalHttpError(response.status, body, t).message)
  const ticket = body?.data?.ticket
  if (typeof ticket !== 'string' || !ticket) throw new Error(t('Host 没有返回终端票据。'))
  return { ticket }
}

interface TerminalTab {
  readonly key: number
  readonly target: TerminalTarget
}

let tabSequence = 0

export default function OpsTerminalPage() {
  const i18n = useI18n()
  const [targets, setTargets] = useState<TerminalTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; kind: string } | null>(null)
  const [selected, setSelected] = useState('')
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [active, setActive] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchTargets(i18n.t).then(list => {
      setTargets(list)
      setError(null)
      setSelected(previous => (list.some(item => item.id === previous && item.available) ? previous : list.find(item => item.available)?.id ?? ''))
    }, (caught: unknown) => {
      const kind = (caught as { kind?: string })?.kind ?? 'failed'
      setError({ message: caught instanceof Error ? caught.message : String(caught), kind })
    }).finally(() => setLoading(false))
  }, [i18n])
  useEffect(() => { load() }, [load])

  const [confirmInsecure, setConfirmInsecure] = useState<TerminalTarget | null>(null)
  const selectedTarget = targets.find(item => item.id === selected) ?? null

  const open = () => {
    const target = targets.find(item => item.id === selected && item.available)
    if (!target) return
    // An unverified SSH host key could be a man in the middle: ask before every new session.
    if (terminalNeedsConfirmation(target)) { setConfirmInsecure(target); return }
    openTab(target)
  }
  const openTab = (target: TerminalTarget) => {
    const key = ++tabSequence
    setTabs(previous => [...previous, { key, target }])
    setActive(key)
  }
  const close = (key: number) => {
    setTabs(previous => {
      const next = previous.filter(tab => tab.key !== key)
      setActive(current => (current === key ? next[next.length - 1]?.key ?? null : current))
      return next
    })
  }

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("终端")}
        description={i18n.t("宿主机 Shell 与白名单里的 SSH 目标。终端等同宿主机的完整 Shell 权限；断开连接即结束会话，不做后台保活。")}
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新目标")}</Button>}
      />
      {error ? (
        error.kind === 'forbidden'
          ? <StatusState kind="forbidden" permissions={['ops.terminal']} description={error.message} />
          : error.kind === 'disabled'
            ? <StatusState kind="needs-configuration" title={i18n.t("终端未启用")} description={error.message} />
            : <StatusState error={error.message} onRetry={load} />
      ) : null}
      {!loading && !error && !targets.length ? (
        <StatusState kind="empty" title={i18n.t("没有可用的终端目标")} description={i18n.t("在 Host 配置的 console.terminal 里启用本机 Shell 或添加 SSH 目标，重启网关后刷新。")} onRetry={load} />
      ) : null}
      {loading && !targets.length && !error ? <Skeleton className="h-10" /> : null}
      {targets.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 space-y-1">
            <span className="block text-sm font-medium" id="ops-terminal-target">{i18n.t("目标")}</span>
            <SelectField className="h-8 w-64" aria-labelledby="ops-terminal-target" value={selected} onValueChange={setSelected}
              options={targets.map(item => ({
                value: item.id,
                label: `${item.kind === 'local' ? i18n.t("本机") : 'SSH'} · ${item.label}${item.available ? '' : ` (${i18n.t("不可用")})`}`,
                disabled: !item.available,
              }))} />
          </div>
          <Button size="sm" onClick={open} disabled={!targets.some(item => item.id === selected && item.available)}><Plus />{i18n.t("打开终端")}</Button>
          {terminalNeedsConfirmation(selectedTarget) ? <InsecureHostKeyBadge /> : null}
        </div>
      ) : null}
      {confirmInsecure ? (
        <ConfirmDialog open onOpenChange={value => { if (!value) setConfirmInsecure(null) }} variant="destructive"
          title={i18n.t("连接未校验主机密钥的 SSH 目标？")}
          description={i18n.t("{0} 配置了 insecureAcceptAnyHostKey：网关不会校验对方的主机密钥，无法发现中间人攻击，输入的命令和密码可能被截获。只在可信网络中使用，并尽快在 Host 配置中填写 hostKey。", [confirmInsecure.label])}
          confirmLabel={i18n.t("仍然连接")}
          onConfirm={() => { const target = confirmInsecure; setConfirmInsecure(null); openTab(target) }} />
      ) : null}
      {targets.filter(item => !item.available && item.reason).map(item => (
        <p key={item.id} className="text-xs text-muted-foreground">{i18n.t("{0} 不可用：{1}", [item.label, item.reason])}</p>
      ))}
      {!loading && !error && !targets.length ? <p className="text-sm text-muted-foreground">{i18n.t("Host 没有可用的终端目标。")}</p> : null}
      {tabs.length ? (
        <Card className="overflow-hidden p-0">
          <div role="tablist" aria-label={i18n.t("终端会话")} className="flex flex-wrap gap-1 border-b bg-muted/40 p-1">
            {tabs.map((tab, index) => (
              <div key={tab.key} className={`flex items-center rounded-md ${tab.key === active ? 'bg-card shadow-sm' : ''}`}>
                <button type="button" role="tab" aria-selected={tab.key === active} aria-controls={`ops-terminal-panel-${tab.key}`}
                  className="px-3 py-1 text-sm" onClick={() => setActive(tab.key)}>
                  {tab.target.label} <span className="text-muted-foreground">#{index + 1}</span>
                  {terminalNeedsConfirmation(tab.target) ? <ShieldAlert className="ml-1 inline h-3.5 w-3.5 text-destructive" aria-label={i18n.t("未校验主机密钥")} /> : null}
                </button>
                <button type="button" className="mr-1 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={i18n.t("关闭终端 {0}", [tab.target.label])} onClick={() => close(tab.key)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {tabs.map(tab => (
            <div key={tab.key} id={`ops-terminal-panel-${tab.key}`} role="tabpanel" hidden={tab.key !== active}>
              <TerminalPane target={tab.target} active={tab.key === active} />
            </div>
          ))}
        </Card>
      ) : null}
    </PageShell>
  )
}

type PaneStatus = { phase: 'connecting' } | { phase: 'ready' } | { phase: 'ended'; end: TerminalEnd }

function TerminalPane({ target, active }: { target: TerminalTarget; active: boolean }) {
  const i18n = useI18n()
  const toast = useToast()
  const i18nRef = useRef(i18n)
  i18nRef.current = i18n
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const connection = useRef<TerminalConnection | null>(null)
  const [status, setStatus] = useState<PaneStatus>({ phase: 'connecting' })
  const [attempt, setAttempt] = useState(0)

  const fitNow = useCallback(() => {
    if (!host.current || host.current.offsetParent === null) return
    try { fit.current?.fit() } catch { /* not measurable yet */ }
  }, [])

  const copySelection = useCallback(async () => {
    const selection = term.current?.getSelection() ?? ''
    if (!selection) { toast.info(i18nRef.current.t('先在终端里选中要复制的文本。')); return }
    const copied = await copyText(selection, navigator.clipboard, document)
    if (copied) toast.success(i18nRef.current.t('已复制'))
    else toast.error(i18nRef.current.t('无法自动复制，请手动选中复制。'))
  }, [toast])

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) term.current?.paste(text)
    } catch {
      toast.error(i18nRef.current.t('浏览器不允许读取剪贴板，请使用 Ctrl+Shift+V 或右键粘贴。'))
    }
  }, [toast])
  // Key bindings read the latest handlers; the xterm instance must not be recreated for them.
  const handlers = useRef({ copySelection, paste })
  handlers.current = { copySelection, paste }

  // The xterm instance lives as long as the tab; reconnecting keeps the scrollback.
  useEffect(() => {
    if (!host.current) return
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: { background: '#0f1115', foreground: '#e6e6e6' },
    })
    const addon = new FitAddon()
    instance.loadAddon(addon)
    instance.open(host.current)
    term.current = instance
    fit.current = addon
    instance.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      const key = event.key.toLowerCase()
      if (key === 'c') { void handlers.current.copySelection(); return false }
      if (key === 'v') { void handlers.current.paste(); return false }
      return true
    })
    const input = instance.onData(data => { connection.current?.write(data) })
    const binary = instance.onBinary(data => {
      const bytes = new Uint8Array(data.length)
      for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff
      connection.current?.write(bytes)
    })
    const resize = instance.onResize(({ cols, rows }) => { connection.current?.resize(cols, rows) })
    const observer = new ResizeObserver(() => fitNow())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      input.dispose()
      binary.dispose()
      resize.dispose()
      instance.dispose()
      term.current = null
      fit.current = null
    }
  }, [fitNow])

  // One connection per attempt; unmounting the tab ends the session.
  useEffect(() => {
    const instance = term.current
    if (!instance) return
    fitNow()
    if (attempt > 0) instance.writeln(`\r\n\x1b[2m${i18nRef.current.t('— 重新连接 —')}\x1b[0m`)
    setStatus({ phase: 'connecting' })
    const current = createTerminalConnection({
      requestTicket: (id, cols, rows) => requestTicket(id, cols, rows, i18nRef.current.t),
      socketUrl: ticket => terminalSocketUrl(getApiBase(), ticket),
      WebSocket: WebSocket as unknown as new (url: string) => TerminalSocketLike,
      onReady: () => {
        setStatus({ phase: 'ready' })
        // The Host started with the ticket's size; send the current one in case it changed.
        current.resize(instance.cols, instance.rows)
        instance.focus()
      },
      onOutput: bytes => instance.write(bytes),
      onEnd: end => {
        if (connection.current === current) connection.current = null
        setStatus({ phase: 'ended', end })
      },
    }, i18nRef.current.t)
    connection.current = current
    void current.start(target.id, instance.cols, instance.rows)
    return () => {
      if (connection.current === current) connection.current = null
      current.dispose()
    }
  }, [attempt, target.id, fitNow])

  useEffect(() => {
    if (!active) return
    // A hidden tab had no size; measure once it is shown.
    const frame = requestAnimationFrame(() => { fitNow(); term.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [active, fitNow])

  const ended = status.phase === 'ended' ? status.end : null
  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge size="sm" variant={status.phase === 'ready' ? 'success' : status.phase === 'connecting' ? 'warning' : 'secondary'}>
            {status.phase === 'ready' ? i18n.t("已连接") : status.phase === 'connecting' ? i18n.t("连接中") : i18n.t("已断开")}
          </Badge>
          <span className="text-muted-foreground">{target.kind === 'local' ? i18n.t("本机 Shell") : i18n.t("SSH：{0}", [target.label])}</span>
          {terminalNeedsConfirmation(target) ? <InsecureHostKeyBadge /> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copySelection()} title="Ctrl+Shift+C"><Clipboard />{i18n.t("复制")}</Button>
          <Button size="sm" variant="ghost" onClick={() => void paste()} disabled={status.phase !== 'ready'} title="Ctrl+Shift+V"><ClipboardPaste />{i18n.t("粘贴")}</Button>
          <Button size="sm" variant="ghost" onClick={() => term.current?.clear()}><Eraser />{i18n.t("清屏")}</Button>
          {status.phase === 'ended'
            ? <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}><RotateCcw />{i18n.t("重新连接")}</Button>
            : <Button size="sm" variant="ghost" onClick={() => connection.current?.dispose()}><Unplug />{i18n.t("断开")}</Button>}
        </div>
      </div>
      {ended ? (
        <Alert variant={ended.reason === 'process-exit' || ended.reason === 'disconnect' ? 'default' : 'warning'} role="status">
          <AlertTitle>{i18n.t("会话已结束")}</AlertTitle>
          <AlertDescription>
            {ended.message}
            {ended.code !== null ? ` ${i18n.t("退出码 {0}。", [ended.code])}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      <div ref={host} className="h-[60vh] min-h-72 w-full overflow-hidden rounded-md bg-[#0f1115] p-1" aria-label={i18n.t("终端 {0}", [target.label])} />
    </div>
  )
}

/** Explicit warning for SSH targets with `insecureHostKey: true` (besides the Host's label suffix). */
function InsecureHostKeyBadge() {
  const i18n = useI18n()
  return (
    <Badge size="sm" variant="destructive" title={i18n.t("网关不会校验这个 SSH 目标的主机密钥（insecureAcceptAnyHostKey）。")}>
      <ShieldAlert className="mr-1 h-3 w-3" />{i18n.t("未校验主机密钥")}
    </Badge>
  )
}
