import { parse } from 'yaml'

export function validateConfigSource(source, format) {
  let value
  try {
    value = format === 'json' ? JSON.parse(source) : parse(source)
  } catch {
    return `${format.toUpperCase()} 格式有误，请检查括号、引号和缩进。`
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '配置须为键值对象，不能是空内容、数组或单个值。'
  }
  return null
}
