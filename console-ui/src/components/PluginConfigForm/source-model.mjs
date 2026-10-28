import { translate } from '../../i18n/locale.mjs'
import { parse, parseDocument, stringify, visit } from 'yaml'
export function parseConfigDocument(source, format, locale = 'zh-CN') {
  const document = format === 'json' ? JSON.parse(source) : parse(source)
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error(translate(locale, "配置源码必须是键值对象"))
  return document
}
export function configAtPath(document, path, locale = 'zh-CN') {
  if (!Array.isArray(path) || path.length === 0) throw new Error(translate(locale, "Host 未提供配置路径，请刷新或打开完整源码"))
  return path.reduce((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, document)
}
export function replaceConfigAtPath(document, path, value, locale = 'zh-CN') {
  if (!Array.isArray(path) || path.length === 0 || path.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error(translate(locale, "Host 配置路径无效，请刷新或打开完整源码"))
  const result = structuredClone(document)
  let target = result
  for (const [index, key] of path.entries()) {
    if (index === path.length - 1) {
      if (value === undefined) delete target[key]
      else Object.defineProperty(target, key, { value: structuredClone(value), writable: true, configurable: true, enumerable: true })
    }
    else {
      const child = Object.hasOwn(target, key) ? target[key] : undefined
      if (child === undefined && value === undefined) return result
      if (child !== undefined && (!child || typeof child !== 'object' || Array.isArray(child))) throw new Error(translate(locale, "配置父节点不是对象，请打开完整源码确认结构"))
      Object.defineProperty(target, key, { value: { ...(child ?? {}) }, writable: true, configurable: true, enumerable: true })
      target = target[key]
    }
  }
  return result
}
export function configSourceForPlugin(source, format, path, value, locale = 'zh-CN') {
  const next = replaceConfigAtPath(parseConfigDocument(source, format, locale), path, value, locale)
  if (format === 'json') return `${JSON.stringify(next, null, 2)}\n`
  const document = parseDocument(source)
  let hasAlias = false
  visit(document, { Alias() { hasAlias = true } })
  // Alias-bearing documents must be detached before mutation to avoid changing another plugin.
  if (hasAlias) return stringify(next, { lineWidth: 0 })
  if (value === undefined) {
    if (document.hasIn(path)) document.deleteIn(path)
  }
  else document.setIn(path, value)
  return document.toString({ lineWidth: 0 })
}
