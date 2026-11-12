import { translate } from '../i18n/locale.mjs'
import { statusFromError } from '../components/status-state-model.mjs'
export function readErrorSummary(error, resource, locale = 'zh-CN') {
 const text = String(error ?? '')
 // The gateway answers for a stopped instance (ADR 0054 §3) and for a busy database: say which.
 const kind = statusFromError(text).kind
 if (kind === 'instance-unavailable') return translate(locale, "{0}由 Zhin 实例提供，实例现在没有响应。到「运维 → 实例」查看状态与日志，恢复后重试。", [resource])
 if (kind === 'database-busy') return translate(locale, "数据库正忙，暂时读不到{0}。请稍后重试。", [resource])
 const denied = /\bforbidden\b|\b403\b|scope does not allow|无权|权限不足|权限不允许/i.test(text)
 return denied ? translate(locale, "当前身份无权读取{0}。请使用具备相应权限的身份连接 Host。", [resource]) : translate(locale, "{0}读取失败。请检查错误详情后重试。", [resource])
}
export function shouldShowMissingEnv({ loaded, exists, dirty, readFailed }) {
 return loaded && exists === false && !dirty && !readFailed
}
