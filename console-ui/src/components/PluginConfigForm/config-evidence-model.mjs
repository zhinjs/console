import { translate } from '../../i18n/locale.mjs'
import { configurationRuntimeStatus } from './config-live-status.mjs'

/** Save copy follows the Host receipt; a saved file is never reported as an applied one. */
export function configurationSaveSummary(result, locale = 'zh-CN') {
  if (result?.success !== true || typeof result.revision !== 'string' || !result.revision) throw new Error(translate(locale, "Host 未提供完整保存回执，请刷新核对；不要自动重试。"))
  if (Object.hasOwn(result, 'application') && result.application !== undefined || result.applicationError !== undefined) {
    return `${translate(locale, '配置已保存。')} ${configurationRuntimeStatus(result, result.revision, locale).summary}`
  }
  if (result.restartRequired === true) return translate(locale, "配置已保存；Host 配置变化需要重启进程，尚未确认生效。")
  if (result.restartRequired === false) return translate(locale, "配置已保存；当前运行是否一致须另行核对。")
  return translate(locale, "配置已保存；Host 未提供重启判断，请另行核对运行证据。")
}
