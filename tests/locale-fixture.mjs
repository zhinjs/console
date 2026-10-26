import { translate, localizeSchemaField } from '../console-ui/src/i18n/locale.mjs'

// Existing handler tests execute extracted production functions without a React tree.
// Give those harnesses the real Chinese formatter, preserving every business assertion.
export const defaultI18n = Object.freeze({
  locale: 'zh-CN',
  t: (message, values) => translate('zh-CN', message, values),
  number: value => new Intl.NumberFormat('zh-CN').format(value),
  date: (value, options) => new Intl.DateTimeFormat('zh-CN', options).format(new Date(value)),
  setLocale() {},
})
export const useI18n = () => defaultI18n
export { translate, localizeSchemaField }
export const localeModule = { useI18n, localizeSchemaField, translate }
export function isLocaleImport(name) { return /(?:^|\/)i18n(?:\/locale\.mjs)?$/.test(name) }
export function prepareLocaleModule(code) {
  let source = code.replace(/(['"])(?:\.\.\/)+i18n(?:\/locale\.mjs)?\1/g, JSON.stringify(import.meta.url))
  if (source.includes('useI18n()') && !/import\s*\{[^}]*\buseI18n\b/.test(source)) source = `import {useI18n} from ${JSON.stringify(import.meta.url)};\n${source}`
  if (source.includes('localizeSchemaField(') && !/import\s*\{[^}]*\blocalizeSchemaField\b/.test(source)) source = `import {localizeSchemaField} from ${JSON.stringify(import.meta.url)};\n${source}`
  return source
}
