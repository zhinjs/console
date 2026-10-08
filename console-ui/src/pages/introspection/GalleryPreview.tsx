import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { highlightCode } from '../files/highlight-code.mjs'
import { CONSOLE_REST } from '../../contracts/zhin-console'
import { apiFetch } from '../../utils/auth'
import { MessageBody } from '../endpoint-detail/MessageBody'
import type { ReceivedMessage } from '../endpoint-detail/types'
import type { CapabilityItem } from './capability-model'
import { unwrapComponentOutput } from './component-output.mjs'
import { previewParameters } from './preview-parameters.mjs'
import { JsonViewer } from './JsonViewer'
import './component-gallery.css'

export function GalleryPreview({ item, readOnly }: { item: CapabilityItem; readOnly: boolean }) {
  const [output, setOutput] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(!readOnly)
  const container = useRef<HTMLDivElement>(null)
  const name = String(item.name ?? '')
  const owner = String(item.owner ?? '')
  const params = previewParameters(item).text
  useEffect(() => {
    if (readOnly) return
    const controller = new AbortController()
    let started = false
    setOutput(null); setError(''); setLoading(true)
    async function render() {
      if (started || controller.signal.aborted) return
      started = true
      try {
        const response = await apiFetch(CONSOLE_REST.COMPONENT_PREVIEW, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requester: owner, name, props: JSON.parse(params) }),
          signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok || body.success !== true || !body.data || !('output' in body.data)) throw new Error(body.error ?? `HTTP ${response.status}`)
        if (!controller.signal.aborted) {
          setOutput(body.data.output)

        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    // Render only cards near the viewport, and cancel when filtering or leaving the page.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void render() }
    }, { rootMargin: '160px' })
    if (container.current) observer.observe(container.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [name, owner, params, readOnly, attempt])
  return <div ref={container} className="console-component-live-preview" aria-label={`${name} 预览`}>
    {readOnly ? <span className="console-component-preview-state">此连接不支持组件渲染</span>
      : loading ? <span className="console-component-preview-state"><Loader2 className="animate-spin" />加载中</span>
      : error ? <div className="console-component-preview-state console-component-preview-error"><span role="alert">无法预览：{error}</span><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setAttempt(value => value + 1) }}>重试预览</Button></div>
      : <ComponentPreviewOutput output={output} />}
  </div>
}

function ComponentPreviewOutput({ output: originalOutput }: { output: unknown }) {
  const output = unwrapComponentOutput(originalOutput)
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
