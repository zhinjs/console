import { useSyncExternalStore } from 'react'
import { DEFAULT_PALETTE, getThemeSnapshot, setThemePreferences, subscribeTheme, type Palette, type Theme, type ThemeMode } from '../theme'

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => `system:${DEFAULT_PALETTE}:light`)
  const [mode, palette, theme] = snapshot.split(':') as [ThemeMode, Palette, Theme]
  const setMode = (value: ThemeMode) => setThemePreferences({ mode: value })
  const setPalette = (value: Palette) => setThemePreferences({ palette: value })
  const resetTheme = () => setThemePreferences({ mode: 'system', palette: DEFAULT_PALETTE })
  return { theme, mode, palette, setMode, setPalette, resetTheme, setTheme: setMode, toggleTheme: () => setMode(theme === 'light' ? 'dark' : 'light') }
}
