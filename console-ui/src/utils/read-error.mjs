export function readErrorSummary(error, resource) {
 const text = String(error ?? '')
 const denied = /\bforbidden\b|\b403\b|scope does not allow|无权|权限不足|权限不允许/i.test(text)
 return denied ? `当前身份无权读取${resource}。请使用具备相应权限的身份连接 Host。` : `${resource}读取失败。请检查错误详情后重试。`
}
export function shouldShowMissingEnv({ loaded, exists, dirty, readFailed }) {
 return loaded && exists === false && !dirty && !readFailed
}
