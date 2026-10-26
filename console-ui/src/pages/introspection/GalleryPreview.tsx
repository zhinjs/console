import { useI18n } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { Input } from '../../components/ui/input'
import { RenderingDiagnostics } from '../endpoint-detail/RenderingDiagnostics'
import { requestConsole } from '../../utils/console-rpc'
import { createPreviewRequestGate, buildPreviewTarget, readPreviewEndpoints, readPreviewResponse, type PreviewEndpoint, type PreviewTarget } from './target-preview.mjs'
import type { RenderingDiagnostic } from '../endpoint-detail/rendering-diagnostics.mjs'
import { Button } from '../../components/ui/button'
import { highlightCode } from '../files/highlight-code.mjs'
import { CONSOLE_REST, ENDPOINT_RPC } from '../../contracts/zhin-console'
import { apiFetch } from '../../utils/auth'
import { MessageBody } from '../endpoint-detail/MessageBody'
import type { ReceivedMessage } from '../endpoint-detail/types'
import type { CapabilityItem } from './capability-model'
import { unwrapComponentOutput } from './component-output.mjs'
import { previewParameters } from './preview-parameters.mjs'
import { JsonViewer } from './JsonViewer'
import './component-gallery.css'

export function GalleryPreview({ item, readOnly }: { item: CapabilityItem; readOnly: boolean }) {
  const i18n = useI18n()
  const cacheScope = useInboxCacheScope()
  const [output, setOutput] = useState<unknown>(null)
  const [generation, setGeneration] = useState<number>()
  const [rendering, setRendering] = useState<RenderingDiagnostic>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(!readOnly)
  const [target, setTarget] = useState<PreviewTarget>()
  const [endpoints, setEndpoints] = useState<PreviewEndpoint[]>([])
  const [endpointIndex, setEndpointIndex] = useState('')
  const [kind, setKind] = useState('private')
  const [conversationId, setConversationId] = useState('')
  const [parentKind, setParentKind] = useState('')
  const [parentId, setParentId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [targetError, setTargetError] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const gate = useRef(createPreviewRequestGate())
  const catalogSequence = useRef(0)
  const name = String(item.name ?? '')
  const owner = String(item.owner ?? '')
  const params = previewParameters(item).text
  const scopeKey = `${cacheScope ?? ""}:${owner}:${name}:${params}`
  const previousScope = useRef(scopeKey)
  if (previousScope.current !== scopeKey) { gate.current.cancel(); previousScope.current = scopeKey }
  useEffect(() => {
    setTarget(undefined); setEndpointIndex(''); setEndpoints([]); setTargetError(''); setConversationId(''); setParentKind(''); setParentId(''); setThreadId('')
    catalogSequence.current++
    return () => { catalogSequence.current++; gate.current.cancel() }
  }, [name, owner, params, cacheScope])
  useEffect(() => {
    if (readOnly || !isInboxCacheScopeActive(cacheScope)) {
      gate.current.cancel(); setOutput(null); setGeneration(undefined); setRendering(undefined); setError(''); setLoading(false); return
    }
    const request = gate.current.begin()
    let started = false
    setOutput(null); setGeneration(undefined); setRendering(undefined); setError(''); setLoading(true)
    async function render() {
      if (started || !request.current()) return
      started = true
      try {
        const response = await apiFetch(CONSOLE_REST.COMPONENT_PREVIEW, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requester: owner, name, props: JSON.parse(params), ...(target ? { target } : {}) }),
          signal: request.signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
        const result = readPreviewResponse(body, target, i18n.locale)
        if (request.current() && isInboxCacheScopeActive(cacheScope)) { setOutput(result.output); setRendering(result.rendering); setGeneration(result.generation) }
      } catch (caught) {
        if (request.current() && isInboxCacheScopeActive(cacheScope)) setError(caught instanceof Error ? caught.message : String(caught))
      } finally { if (request.current()) setLoading(false) }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void render() }
    }, { rootMargin: '160px' })
    if (container.current) observer.observe(container.current)
    return () => { observer.disconnect(); gate.current.cancel() }
  }, [name, owner, params, readOnly, attempt, target, cacheScope])

  async function loadEndpoints() {
    const sequence = ++catalogSequence.current
    setTargetError('')
    try {
      const value = readPreviewEndpoints(await requestConsole({ type: ENDPOINT_RPC.LIST }), i18n.locale)
      if (sequence !== catalogSequence.current || !isInboxCacheScopeActive(cacheScope)) return
      setEndpoints(value)
      if (!value.length) setTargetError(i18n.t("当前 Host 没有提供可预览的 Endpoint 标识"))
    } catch (caught) { if (sequence === catalogSequence.current && isInboxCacheScopeActive(cacheScope)) setTargetError(caught instanceof Error ? caught.message : String(caught)) }
  }
  function previewTarget() {
    try { if (endpointIndex === '') throw new Error(i18n.t("请选择目标 Endpoint")); setTarget(buildPreviewTarget(endpoints[Number(endpointIndex)]?.endpoint, { kind, id: conversationId, parentKind, parentId, threadId }, i18n.locale)); setTargetError(''); setAttempt(value => value + 1) }
    catch (caught) { setTargetError(caught instanceof Error ? caught.message : String(caught)) }
  }
  const targetName = target && (endpoints.find(value => value.endpoint.id === target.endpoint.id && value.endpoint.adapter === target.endpoint.adapter)?.name ?? target.endpoint.adapter)
  return <div ref={container} className="console-component-live-preview" aria-label={i18n.t("{0} 预览", [name])}>
    <div className="px-3 pt-2 text-[11px] text-muted-foreground">
      {target ? i18n.t("目标预览：{0} / {1} · {2} {3}{4}{5}", [target.endpoint.adapter, targetName, { private: i18n.t("私聊"), group: i18n.t("群聊"), channel: i18n.t("频道") }[target.kind], target.id, target.parent ? ` · 父级 ${target.parent.id}` : '', target.threadId ? ` · 线程 ${target.threadId}` : '']) : i18n.t("作者 HTML / 消息预览")}
      {generation !== undefined && <span> {i18n.t(" · 代次 ")}{generation}</span>}
    </div>
    {readOnly ? <span className="console-component-preview-state">{i18n.t("此连接不支持组件渲染")}</span>
      : loading ? <span className="console-component-preview-state"><Loader2 className="animate-spin" />{i18n.t("加载中")}</span>
      : error ? <div className="console-component-preview-state console-component-preview-error"><span role="alert">{i18n.t("无法预览：")}{error}</span><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setAttempt(value => value + 1) }}>{i18n.t("重试预览")}</Button></div>
      : <div className="px-3 pb-2"><ComponentPreviewOutput output={output} />{target && <RenderingDiagnostics rendering={rendering} preview />}</div>}
    {!readOnly && <details className="border-t p-3 text-xs" onClick={event => event.stopPropagation()}>
      <summary className="cursor-pointer">{i18n.t("按目标 Endpoint 预览")}</summary>
      <p className="my-2 text-muted-foreground">{i18n.t("不会发送消息或注册按钮回调；不运行出站中间件。实际发送记录是最终诊断依据。")}</p>
      <Button size="sm" variant="outline" onClick={() => void loadEndpoints()}>{i18n.t("加载 Endpoint")}</Button>
      <div className="mt-2 grid gap-2">
        <label>Endpoint<select className="console-control mt-1 w-full rounded border bg-background p-2" value={endpointIndex} onChange={event => setEndpointIndex(event.target.value)}><option value="">{i18n.t("请选择")}</option>{endpoints.map((endpoint, index) => <option key={JSON.stringify(endpoint.endpoint)} value={index}>{endpoint.endpoint.adapter} / {endpoint.name}{endpoint.connected ? '' : i18n.t("（离线）")}</option>)}</select></label>
        <label>{i18n.t("会话类型")}<select className="console-control mt-1 w-full rounded border bg-background p-2" value={kind} onChange={event => setKind(event.target.value)}><option value="private">{i18n.t("私聊")}</option><option value="group">{i18n.t("群聊")}</option><option value="channel">{i18n.t("频道")}</option></select></label>
        <Input aria-label={i18n.t("目标会话 ID")} placeholder={i18n.t("会话 ID")} value={conversationId} onChange={event => setConversationId(event.target.value)} />
        <label>{i18n.t("父级（可选）")}<select className="console-control mt-1 w-full rounded border bg-background p-2" value={parentKind} onChange={event => setParentKind(event.target.value)}><option value="">{i18n.t("无")}</option><option value="group">{i18n.t("群聊")}</option><option value="channel">{i18n.t("频道 / 服务器")}</option></select></label>
        <Input aria-label={i18n.t("父级 ID")} placeholder={i18n.t("父级 ID（填写父级类型时必填）")} value={parentId} onChange={event => setParentId(event.target.value)} />
        <Input aria-label={i18n.t("线程 ID")} placeholder={i18n.t("线程 ID（可选）")} value={threadId} onChange={event => setThreadId(event.target.value)} />
        {targetError && <span role="alert" className="text-destructive">{targetError}</span>}
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={previewTarget} disabled={endpointIndex === ''}>{i18n.t("目标预览")}</Button><Button size="sm" variant="outline" onClick={() => { setTarget(undefined); setAttempt(value => value + 1) }}>{i18n.t("作者预览")}</Button></div>
      </div>
    </details>}
  </div>
}

function ComponentPreviewOutput({ output: originalOutput }: { output: unknown }) {
  const i18n = useI18n()
  const output = unwrapComponentOutput(originalOutput)
  if (output == null || Array.isArray(output) && output.length === 0) return <span className="text-xs text-muted-foreground">{i18n.t("组件未渲染内容")}</span>
  const values = (Array.isArray(output) ? output : [output]).map((value) =>
    typeof value === 'string' ? { type: 'text', data: { text: value } } : value)
  const segments = values.filter((value): value is ReceivedMessage['content'][number] => (
    Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
  ))
  if (segments.length === values.length && segments.length > 0) {
    if (segments.length === 1 && segments[0].type === 'html') {
      const data = segments[0].data ?? {}
      const html = typeof data.html === 'string' ? data.html : ''
      const height = clampPreviewDimension(data.height, 320, 160, 640)
      if (html) {
        return <HtmlGalleryPreview html={html} initialHeight={height} />
      }
    }
    if (segments.length === 1 && segments[0].type === 'code') {
      const data = segments[0].data ?? {}
      return <pre className="overflow-auto"><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(String(data.code ?? data.text ?? ''), String(data.language ?? '')) }} /></pre>
    }
    return <MessageBody content={segments} />
  }
  if (typeof output === 'string') return <MessageBody content={[{ type: 'text', data: { text: output } }]} />
  return <JsonViewer value={output} />
}

function clampPreviewDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}


function HtmlGalleryPreview({ html, initialHeight }: { html: string; initialHeight: number }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [nonce] = useState(() => crypto.randomUUID())
  const [height, setHeight] = useState(initialHeight)
  useEffect(() => {
    function onSize(event: MessageEvent) {
      if (event.source !== iframe.current?.contentWindow || event.data?.nonce !== nonce || event.data?.type !== 'console-component-size') return
      const value = Number(event.data.height)
      if (Number.isFinite(value)) setHeight(Math.ceil(Math.min(2048, Math.max(32, value))))
    }
    window.addEventListener('message', onSize)
    return () => window.removeEventListener('message', onSize)
  }, [nonce])
  // Only this nonce-bound size reporter can execute; component scripts and external resources remain blocked.
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>html,body{margin:0;padding:0;min-height:0}body{display:flow-root;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${html}<script nonce="${nonce}">const report=()=>parent.postMessage({type:'console-component-size',nonce:'${nonce}',height:document.body.getBoundingClientRect().height},'*');new ResizeObserver(report).observe(document.body);report();<\/script></body></html>`
  return <iframe ref={iframe} title="Component HTML preview" sandbox="allow-scripts" srcDoc={srcDoc} className="w-full border-0" style={{ height }} />
}
