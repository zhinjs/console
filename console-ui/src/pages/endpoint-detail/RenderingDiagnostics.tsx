import type { RenderingDiagnostic } from './rendering-diagnostics.mjs'
import { renderingLabels } from './rendering-diagnostics.mjs'

export function RenderingDiagnostics({ rendering, messageId, error, preview = false, projection = false }: { rendering?: RenderingDiagnostic; messageId?: string; error?: string; preview?: boolean; projection?: boolean }) {
  const labels = renderingLabels(rendering)
  if (!labels && !error && !messageId) return null
  return <div className="mt-2 border-t border-current/10 pt-1.5 text-[11px] leading-relaxed opacity-90" aria-label={projection ? '出站内容投影诊断' : preview ? '目标预览渲染诊断' : '实际发送渲染诊断'}>
    {messageId && <div className="break-all" title={messageId}>消息 ID：<code>{messageId}</code></div>}
    {labels && <>
      <div>{projection ? '出站投影' : preview ? '目标预览' : '传给 Endpoint'}：{labels.forms.join('、') || '空内容'}</div>
      {labels.fallbacks.length > 0 ? <div className="text-amber-700 dark:text-amber-300">降级原因：{labels.fallbacks.join('；')}</div> : <div>未发生格式降级</div>}
    </>}
    {error && <div role="alert">诊断不可用：{error}</div>}
    {projection && labels ? <div className="opacity-75">仅记录内容转换结果，不能据此证明 Endpoint 已发送或平台已接收。</div> : !preview && labels && <div className="opacity-75">最终发送链路记录；平台客户端显示可能不同。</div>}
  </div>
}
