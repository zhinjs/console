import { useI18n } from '../../i18n'
import type { RenderingDiagnostic } from './rendering-diagnostics.mjs'
import { renderingLabels } from './rendering-diagnostics.mjs'

export function RenderingDiagnostics({ rendering, messageId, error, preview = false, projection = false }: { rendering?: RenderingDiagnostic; messageId?: string; error?: string; preview?: boolean; projection?: boolean }) {
  const i18n = useI18n()
  const labels = renderingLabels(rendering, i18n.locale)
  if (!labels && !error && !messageId) return null
  return <div className="mt-2 border-t border-current/10 pt-1.5 text-[11px] leading-relaxed opacity-90" aria-label={projection ? i18n.t("出站内容投影诊断") : preview ? i18n.t("目标预览渲染诊断") : i18n.t("实际发送渲染诊断")}>
    {messageId && <div className="break-all" title={messageId}>{i18n.t("消息 ID：")}<code>{messageId}</code></div>}
    {labels && <>
      <div>{projection ? i18n.t("出站投影") : preview ? i18n.t("目标预览") : i18n.t("传给 Endpoint")}：{labels.forms.join('、') || i18n.t("空内容")}</div>
      {labels.fallbacks.length > 0 ? <div className="text-amber-700 dark:text-amber-300">{i18n.t("降级原因：")}{labels.fallbacks.join('；')}</div> : <div>{i18n.t("未发生格式降级")}</div>}
    </>}
    {error && <div role="alert">{i18n.t("诊断不可用：")}{error}</div>}
    {projection && labels ? <div className="opacity-75">{i18n.t("仅记录内容转换结果，不能据此证明 Endpoint 已发送或平台已接收。")}</div> : !preview && labels && <div className="opacity-75">{i18n.t("最终发送链路记录；平台客户端显示可能不同。")}</div>}
  </div>
}
