import { englishMessages } from './messages.en.mjs'

export const LOCALE_STORAGE_KEY = 'zhin.console.locale'
export const DEFAULT_LOCALE = 'zh-CN'

export function isLocale(value) { return value === 'zh-CN' || value === 'en' }

/** Explicit saved preference only. Browser language never changes the Chinese default. */
export function readLocale(storage) {
  try { const value = storage?.getItem(LOCALE_STORAGE_KEY); return isLocale(value) ? value : DEFAULT_LOCALE }
  catch { return DEFAULT_LOCALE }
}

/** Storage failure does not discard the current session's chosen interface language. */
export function saveLocale(storage, locale) {
  if (!isLocale(locale)) throw new TypeError('Unsupported Console locale')
  try { storage?.setItem(LOCALE_STORAGE_KEY, locale); return true } catch { return false }
}

/** Only explicitly authored UI copy is translated. Interpolated values are inserted verbatim. */
export function translate(locale, message, values = [], context) {
  if (typeof message !== 'string') return message
  const contextualKey = context ? `${context}\u0004${message}` : message
  const key = Object.hasOwn(englishMessages, contextualKey) ? contextualKey : message
  const template = locale === 'en' && Object.hasOwn(englishMessages, key) ? englishMessages[key] : message
  return template.replace(/\{(\d+)\}/gu, (placeholder, index) => Number(index) < values.length ? String(values[Number(index)]) : placeholder)
}

/** Presentation only. Field names, validation, defaults and option values retain their identity. */
export function localizeSchemaField(field, locale) {
  if (!field || locale === DEFAULT_LOCALE) return field
  const options = field.options ?? (Array.isArray(field.enum) ? field.enum.map(value => ({ value, label: String(value) })) : undefined)
  const copy = field['x-i18n']?.[locale] ?? (Array.isArray(options) ? {} : undefined)
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return field
  return {
    ...field,
    ...(typeof copy.title === 'string' ? { title: copy.title } : {}),
    ...(typeof copy.description === 'string' ? { description: copy.description } : {}),
    ...(Array.isArray(options)
      ? { options: options.map(option => {
          const label = copy.enumLabels?.[String(option.value)] ?? option['x-i18n']?.[locale]?.title
          return typeof label === 'string' ? { ...option, label } : option
        }) }
      : {}),
  }
}
