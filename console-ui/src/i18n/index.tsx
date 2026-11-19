import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, englishCatalogReady, isLocale, loadEnglishCatalog, readLocale, saveLocale, translate, type Locale } from './locale.mjs'
export { localizeSchemaField, type Locale } from './locale.mjs'

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

function createPresentation(locale: Locale) {
  return {
    locale,
    t: (message: string, values?: readonly unknown[], context?: string) => translate(locale, message, values, context),
    date: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(new Date(value)),
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value),
  }
}

interface LocaleContextValue extends ReturnType<typeof createPresentation> {
  setLocale(locale: Locale): void
}
const LocaleContext = createContext<LocaleContextValue>({ ...createPresentation(DEFAULT_LOCALE), setLocale: () => {} })

/** UI-owned state. Never writes Bot configuration, sender preferences, or authentication storage. */
export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setValue] = useState<Locale>(() => initialLocale ?? readLocale(browserStorage()))
  // English copy is downloaded on demand (#64 `english-catalog-lazy`): an English start waits for it
  // instead of flashing Chinese, and switching to English loads it before the interface changes.
  const [catalogReady, setCatalogReady] = useState(() => locale !== 'en' || englishCatalogReady())
  useEffect(() => {
    if (catalogReady) return
    let current = true
    loadEnglishCatalog().then(
      () => { if (current) setCatalogReady(true) },
      // The catalog could not be fetched: show the interface in Chinese rather than nothing.
      () => { if (current) { setValue(DEFAULT_LOCALE); setCatalogReady(true) } },
    )
    return () => { current = false }
  }, [catalogReady])
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return
    saveLocale(browserStorage(), next)
    if (next !== 'en' || englishCatalogReady()) { setValue(next); return }
    loadEnglishCatalog().then(() => setValue(next), () => {})
  }, [])
  const value = useMemo(() => ({ ...createPresentation(locale), setLocale }), [locale, setLocale])
  useEffect(() => {
    document.documentElement.lang = locale
    // The product name is not translated (CONSOLE_PRODUCT_NAME of @zhin.js/console-ui, client/index.html).
    document.title = 'Zhin Console'
    document.querySelector('meta[name=description]')?.setAttribute('content', translate(locale, '管理 Zhin Bot 的渠道、能力、Agent、自动化与运行状态。'))
  }, [locale])
  if (!catalogReady) return null
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n(): LocaleContextValue { return useContext(LocaleContext) }

/** Class components can mark authored UI copy without introducing mutable module state. */
export function LocalizedText({ message, values }: { message: string; values?: readonly unknown[] }) {
  const { t } = useI18n()
  return <>{t(message, values)}</>
}
