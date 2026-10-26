import { translate } from '../i18n/locale.mjs'
export function readErrorSummary(error, resource, locale = 'zh-CN') {
 const text = String(error ?? '')
 const denied = /\bforbidden\b|\b403\b|scope does not allow|无权|权限不足|权限不允许/i.test(text)
 return denied ? translate(locale, "当前身份无权读取{0}。请使用具备相应权限的身份连接 Host。", [resource]) : translate(locale, "{0}读取失败。请检查错误详情后重试。", [resource])
}
export function shouldShowMissingEnv({ loaded, exists, dirty, readFailed }) {
 return loaded && exists === false && !dirty && !readFailed
}
