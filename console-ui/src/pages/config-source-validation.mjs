import { translate } from '../i18n/locale.mjs'
import { parse } from 'yaml'

export function validateConfigSource(source, format, locale = 'zh-CN') {
  let value
  try {
    value = format === 'json' ? JSON.parse(source) : parse(source)
  } catch {
    return translate(locale, "{0} 格式有误，请检查括号、引号和缩进。", [format.toUpperCase()])
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return translate(locale, "配置须为键值对象，不能是空内容、数组或单个值。")
  }
  return null
}
