import { translate } from '../i18n/locale.mjs'
import { validateManagementState } from './plugin-management-model.mjs'
export function validatePluginList(payload, locale = 'zh-CN') {
  if (!payload || payload.success !== true || !Array.isArray(payload.data)) throw new Error(translate(locale, "插件列表格式无效"))
  for (const plugin of payload.data) {
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name || !['active', 'inactive'].includes(plugin.status) || !Array.isArray(plugin.features)) throw new Error(translate(locale, "插件信息格式无效"))
    if (plugin.management) validateManagementState(plugin.management, plugin.instanceKey, locale)
    for (const feature of plugin.features) {
      if (!feature || typeof feature.name !== 'string' || !Number.isSafeInteger(feature.count) || feature.count < 0) throw new Error(translate(locale, "插件能力格式无效"))
    }
  }
  return payload.data
}
