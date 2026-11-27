// Browser presentation only. CSS owns colors; preferences never enter Bot configuration.
//
// Colors come from @zhin.js/console-ui 1.3.0 (「柔光卡片」, ADR 0063 D34–D38): one fixed soft-card
// palette, light and dark. The Console only picks the mode:
//   light  → `.light` on <html>, no `data-theme` (the library is light when nothing is written);
//   dark   → `.dark` on <html>;
//   system → `data-theme="system"` on <html> (the library's opt-in `prefers-color-scheme` rule) plus
//            the resolved `.light` / `.dark` class, kept in step with the system, for the Console's
//            own `.dark` rules and Tailwind's `dark:` variant.
// There is no palette any more: a saved `zhin.console.palette` is ignored and removed.
export type Theme = 'light' | 'dark'
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = typeof THEME_MODES[number]
export interface ThemePreferences { mode: ThemeMode }
export const THEME_STORAGE_KEY = 'theme'
/** The palette preference of Console ≤ 1.2 (console-ui ≤ 1.2.x); read only to delete it. */
export const LEGACY_PALETTE_STORAGE_KEY = 'zhin.console.palette'
/** `<meta name="theme-color">`: the soft-card page background (`--console-bg`). */
export const THEME_COLORS: Readonly<Record<Theme, string>> = Object.freeze({ light: '#F7F5F3', dark: '#121010' })
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
function storage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
function stored(key: string): string | null { try { return storage()?.getItem(key) ?? null } catch { return null } }
function readStoredPreferences(): ThemePreferences {
  const mode = stored(THEME_STORAGE_KEY)
  return { mode: isThemeMode(mode) ? mode : 'system' }
}
export function getThemePreferences(): ThemePreferences {
  const saved = readStoredPreferences()
  if (typeof document === 'undefined') return saved
  const { themeMode } = document.documentElement.dataset
  return { mode: isThemeMode(themeMode) ? themeMode : saved.mode }
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
  if (preferences.mode === 'system') root.dataset.theme = 'system'
  else delete root.dataset.theme
  delete root.dataset.palette
  for (const key of legacyThemeVariables) root.style.removeProperty(`--${key}`)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
  return theme
}
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT)) }
export function setThemePreferences(update: Partial<ThemePreferences>): void {
  if (update.mode !== undefined && !isThemeMode(update.mode)) throw new TypeError('Invalid appearance preference')
  const preferences = getThemePreferences()
  if (update.mode !== undefined) {
    preferences.mode = update.mode
    // One bounded, validated scalar preference. Blocked storage keeps the current session usable.
    try { storage()?.setItem(THEME_STORAGE_KEY, update.mode) } catch { /* session-only preference */ }
  }
  renderTheme(preferences)
  notify()
}
/** Compatibility for existing consumers selecting a resolved light/dark mode. */
export function applyTheme(theme: Theme) { setThemePreferences({ mode: theme }) }
/** Stable primitive snapshot shared by every theme control, including other browser tabs. */
export function getThemeSnapshot(): string {
  const preferences = getThemePreferences()
  return `${preferences.mode}:${resolveTheme(preferences.mode)}`
}
export function subscribeTheme(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(THEME_EVENT, listener)
  return () => window.removeEventListener(THEME_EVENT, listener)
}
export function initializeTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  runtimes.get(window)?.()
  // The palette picker is gone (console-ui 1.3.0): drop its saved choice once.
  try { if (stored(LEGACY_PALETTE_STORAGE_KEY) !== null) storage()?.removeItem(LEGACY_PALETTE_STORAGE_KEY) } catch { /* nothing to clean */ }
  const theme = renderTheme(readStoredPreferences())
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    const preferences = getThemePreferences()
    if (preferences.mode === 'system') { renderTheme(preferences); notify() }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
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
