import { useSyncExternalStore } from 'react'
import { getThemeSnapshot, setThemePreferences, subscribeTheme, type Theme, type ThemeMode } from '../theme'

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'system:light')
  const [mode, theme] = snapshot.split(':') as [ThemeMode, Theme]
  const setMode = (value: ThemeMode) => setThemePreferences({ mode: value })
  const resetTheme = () => setThemePreferences({ mode: 'system' })
  return { theme, mode, setMode, resetTheme, setTheme: setMode, toggleTheme: () => setMode(theme === 'light' ? 'dark' : 'light') }
}
