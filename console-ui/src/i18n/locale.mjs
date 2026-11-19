/**
 * The English catalog (~446KB) is loaded only when English is used (#64 `english-catalog-lazy`): the
 * default Chinese interface never downloads it. Until it is installed, `translate` keeps the source text.
 */
let englishMessages = null
let englishLoading = null

/** Whether English copy is available now. */
export function englishCatalogReady() { return englishMessages !== null }

/** Installs a catalog directly (tests and pre-bundled hosts); `loadEnglishCatalog` does this on demand. */
export function installEnglishCatalog(messages) {
  if (!messages || typeof messages !== 'object') throw new TypeError('English catalog must be an object')
  englishMessages = messages
}

/** Loads the English catalog once; resolves when `translate('en', …)` returns English. */
export function loadEnglishCatalog() {
  if (englishMessages) return Promise.resolve()
  englishLoading ??= import('./messages.en.mjs').then(
    (module) => { installEnglishCatalog(module.englishMessages) },
    (error) => { englishLoading = null; throw error },
  )
  return englishLoading
}

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

const englishPlurals = new Intl.PluralRules('en')

/**
 * A count-bearing English entry is `{ one, other }`: the form follows the count in `{0}` (a number,
 * or a string of digits). Anything that is not a plain count (formatted 「1,234」, text) takes `other`.
 */
function pluralForm(forms, count) {
  const value = typeof count === 'number' ? count : typeof count === 'string' && /^-?\d+(?:\.\d+)?$/u.test(count.trim()) ? Number(count) : NaN
  const category = Number.isFinite(value) ? englishPlurals.select(value) : 'other'
  return typeof forms?.[category] === 'string' ? forms[category] : forms.other
}

/** Only explicitly authored UI copy is translated. Interpolated values are inserted verbatim. */
export function translate(locale, message, values = [], context) {
  if (typeof message !== 'string') return message
  const catalog = locale === 'en' ? englishMessages : null
  const contextualKey = context ? `${context}\u0004${message}` : message
  const key = catalog && Object.hasOwn(catalog, contextualKey) ? contextualKey : message
  const entry = catalog && Object.hasOwn(catalog, key) ? catalog[key] : message
  const template = typeof entry === 'string' ? entry : pluralForm(entry, values[0])
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
