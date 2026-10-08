// CSS owns the palette; runtime selects a mode and removes legacy inline overrides.
export type Theme = 'light' | 'dark'
const legacyThemeVariables = [
  'background','foreground','card','card-foreground','popover','popover-foreground',
  'primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground',
  'accent','accent-foreground','destructive','destructive-foreground','border','input','ring','radius',
  'chart-1','chart-2','chart-3','chart-4','chart-5','sidebar','sidebar-foreground','sidebar-primary',
  'sidebar-primary-foreground','sidebar-accent','sidebar-accent-foreground','sidebar-border','sidebar-ring',
] as const

// Apply theme to document
export function applyTheme(theme: Theme) {
  const root = document.documentElement

  // Remove old theme class
  root.classList.remove('light', 'dark')
  // Add new theme class
  root.classList.add(theme)

  // Clear only variables written by prior Console versions, not host/extension styles.
  for (const key of legacyThemeVariables) root.style.removeProperty(`--${key}`)

  // Save to localStorage
  localStorage.setItem('theme', theme)
}

// Get current theme from localStorage or system preference
export function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null
  if (stored && (stored === 'light' || stored === 'dark')) {
    return stored
  }

  // Check system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }

  return 'light'
}

// Initialize theme on app load
export function initializeTheme() {
  const theme = getInitialTheme()
  applyTheme(theme)
  return theme
}
