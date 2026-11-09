// Browser presentation only. CSS owns colors; preferences never enter Bot configuration.
export type Theme = 'light' | 'dark'
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = typeof THEME_MODES[number]
export const THEME_PALETTES = [
  { id: 'forest', label: '松青', swatch: '#317d61', light: '#f8faf9', dark: '#131b18' },
  { id: 'ocean', label: '海蓝', swatch: '#316aaf', light: '#f7f8fa', dark: '#12161c' },
  { id: 'plum', label: '暮紫', swatch: '#754c94', light: '#f9f8fa', dark: '#17131b' },
  { id: 'graphite', label: '石墨', swatch: '#4d4d4d', light: '#f9f9f9', dark: '#171717' },
] as const
export type Palette = typeof THEME_PALETTES[number]['id']
export interface ThemePreferences { mode: ThemeMode; palette: Palette }
export const THEME_STORAGE_KEY = 'theme'
export const PALETTE_STORAGE_KEY = 'zhin.console.palette'
const THEME_EVENT = 'zhin:appearance-change'
const runtimes = new WeakMap<Window, () => void>()
const legacyThemeVariables = [
  'background','foreground','card','card-foreground','popover','popover-foreground',
  'primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground',
  'accent','accent-foreground','destructive','destructive-foreground','border','input','ring','radius',
  'chart-1','chart-2','chart-3','chart-4','chart-5','sidebar','sidebar-foreground','sidebar-primary',
  'sidebar-primary-foreground','sidebar-accent','sidebar-accent-foreground','sidebar-border','sidebar-ring',
] as const
export function isThemeMode(value: unknown): value is ThemeMode { return THEME_MODES.some(mode => mode === value) }
export function isPalette(value: unknown): value is Palette { return THEME_PALETTES.some(palette => palette.id === value) }
function storage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
function stored(key: string): string | null { try { return storage()?.getItem(key) ?? null } catch { return null } }
function readStoredPreferences(): ThemePreferences {
  const mode = stored(THEME_STORAGE_KEY), palette = stored(PALETTE_STORAGE_KEY)
  return { mode: isThemeMode(mode) ? mode : 'system', palette: isPalette(palette) ? palette : 'forest' }
}
export function getThemePreferences(): ThemePreferences {
  const saved = readStoredPreferences()
  if (typeof document === 'undefined') return saved
  const { themeMode, palette } = document.documentElement.dataset
  return { mode: isThemeMode(themeMode) ? themeMode : saved.mode, palette: isPalette(palette) ? palette : saved.palette }
}
export function resolveTheme(mode: ThemeMode): Theme {
  if (mode !== 'system') return mode
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function renderTheme(preferences: ThemePreferences): Theme {
  const theme = resolveTheme(preferences.mode)
  if (typeof document === 'undefined') return theme
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  root.dataset.themeMode = preferences.mode
  root.dataset.palette = preferences.palette
  for (const key of legacyThemeVariables) root.style.removeProperty(`--${key}`)
  const palette = THEME_PALETTES.find(value => value.id === preferences.palette)!
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[theme])
  return theme
}
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT)) }
export function setThemePreferences(update: Partial<ThemePreferences>): void {
  if (update.mode !== undefined && !isThemeMode(update.mode) || update.palette !== undefined && !isPalette(update.palette)) throw new TypeError('Invalid appearance preference')
  const preferences = getThemePreferences()
  if (update.mode !== undefined) preferences.mode = update.mode
  if (update.palette !== undefined) preferences.palette = update.palette
  // Only two bounded, validated scalar preferences. Blocked storage keeps the current session usable.
  for (const [key, value] of [[THEME_STORAGE_KEY, update.mode], [PALETTE_STORAGE_KEY, update.palette]] as const) {
    if (value !== undefined) { try { storage()?.setItem(key, value) } catch { /* session-only preference */ } }
  }
  renderTheme(preferences)
  notify()
}
/** Compatibility for existing consumers selecting a resolved light/dark mode. */
export function applyTheme(theme: Theme) { setThemePreferences({ mode: theme }) }
export function getInitialTheme(): Theme { return resolveTheme(readStoredPreferences().mode) }
/** Stable primitive snapshot shared by every theme control, including other browser tabs. */
export function getThemeSnapshot(): string {
  const preferences = getThemePreferences()
  return `${preferences.mode}:${preferences.palette}:${resolveTheme(preferences.mode)}`
}
export function subscribeTheme(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(THEME_EVENT, listener)
  return () => window.removeEventListener(THEME_EVENT, listener)
}
export function initializeTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  runtimes.get(window)?.()
  const theme = renderTheme(readStoredPreferences())
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    const preferences = getThemePreferences()
    if (preferences.mode === 'system') { renderTheme(preferences); notify() }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY && event.key !== PALETTE_STORAGE_KEY) return
    if (event.storageArea && event.storageArea !== storage()) return
    renderTheme(readStoredPreferences())
    notify()
  }
  media?.addEventListener('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  runtimes.set(window, () => { media?.removeEventListener('change', onSystemChange); window.removeEventListener('storage', onStorage) })
  notify()
  // Initialization deliberately does not persist the system's resolved light/dark choice.
  return theme
}
