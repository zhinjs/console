import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, isLocale, readLocale, saveLocale, translate, type Locale } from './locale.mjs'
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
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return
    saveLocale(browserStorage(), next)
    setValue(next)
  }, [])
  const value = useMemo(() => ({ ...createPresentation(locale), setLocale }), [locale, setLocale])
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = translate(locale, 'Zhin Bot 工作台')
    document.querySelector('meta[name=description]')?.setAttribute('content', translate(locale, '管理 Zhin Bot 的渠道、能力、Agent、自动化与运行状态。'))
  }, [locale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n(): LocaleContextValue { return useContext(LocaleContext) }

/** Class components can mark authored UI copy without introducing mutable module state. */
export function LocalizedText({ message, values }: { message: string; values?: readonly unknown[] }) {
  const { t } = useI18n()
  return <>{t(message, values)}</>
}
