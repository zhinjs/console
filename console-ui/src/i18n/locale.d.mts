export type Locale = 'zh-CN' | 'en'
export const LOCALE_STORAGE_KEY: string
export const DEFAULT_LOCALE: 'zh-CN'
export function isLocale(value: unknown): value is Locale
export function readLocale(storage?: Pick<Storage, 'getItem'>): Locale
export function saveLocale(storage: Pick<Storage, 'setItem'> | undefined, locale: Locale): boolean
export function translate(locale: Locale, message: string, values?: readonly unknown[], context?: string): string
export function localizeSchemaField<T>(field: T, locale: Locale): T
