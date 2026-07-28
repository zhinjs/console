// Theme configuration - Zhin emerald palette (aligned with zhin.js.org brand)
export const themes = {
  light: {
    background: '150 30% 97%',
    foreground: '158 28% 10%',
    card: '0 0% 100%',
    'card-foreground': '158 28% 10%',
    popover: '0 0% 100%',
    'popover-foreground': '158 28% 10%',
    primary: '154 54% 40%',
    'primary-foreground': '150 60% 98%',
    secondary: '152 35% 94%',
    'secondary-foreground': '155 50% 20%',
    muted: '152 30% 94%',
    'muted-foreground': '156 12% 38%',
    accent: '152 55% 92%',
    'accent-foreground': '154 55% 24%',
    destructive: '0 84.2% 60.2%',
    'destructive-foreground': '0 0% 98%',
    border: '152 24% 88%',
    input: '152 24% 88%',
    ring: '154 54% 40%',
    radius: '0.5rem',
    'chart-1': '154 54% 40%',
    'chart-2': '188 65% 38%',
    'chart-3': '262 52% 58%',
    'chart-4': '38 92% 50%',
    'chart-5': '340 72% 55%',
    sidebar: '152 32% 98%',
    'sidebar-foreground': '156 14% 32%',
    'sidebar-primary': '154 54% 40%',
    'sidebar-primary-foreground': '0 0% 100%',
    'sidebar-accent': '152 48% 93%',
    'sidebar-accent-foreground': '154 50% 24%',
    'sidebar-border': '152 22% 90%',
    'sidebar-ring': '154 54% 40%',
  },
  dark: {
    background: '158 32% 5%',
    foreground: '150 22% 95%',
    card: '158 24% 8%',
    'card-foreground': '150 22% 95%',
    popover: '158 24% 8%',
    'popover-foreground': '150 22% 95%',
    primary: '151 50% 53%',
    'primary-foreground': '158 65% 7%',
    secondary: '157 18% 14%',
    'secondary-foreground': '150 22% 95%',
    muted: '157 18% 14%',
    'muted-foreground': '152 12% 62%',
    accent: '155 28% 15%',
    'accent-foreground': '151 50% 72%',
    destructive: '0 62.8% 30.6%',
    'destructive-foreground': '0 0% 98%',
    border: '157 16% 15%',
    input: '157 16% 17%',
    ring: '151 50% 53%',
    radius: '0.5rem',
    'chart-1': '151 50% 53%',
    'chart-2': '188 60% 55%',
    'chart-3': '262 60% 70%',
    'chart-4': '40 90% 60%',
    'chart-5': '340 70% 65%',
    sidebar: '158 28% 6.5%',
    'sidebar-foreground': '152 14% 75%',
    'sidebar-primary': '151 50% 53%',
    'sidebar-primary-foreground': '158 65% 7%',
    'sidebar-accent': '156 22% 12%',
    'sidebar-accent-foreground': '151 45% 72%',
    'sidebar-border': '157 16% 14%',
    'sidebar-ring': '151 50% 53%',
  },
} as const

export type Theme = keyof typeof themes
export type ThemeColors = typeof themes.light

// Apply theme to document
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  const colors = themes[theme]

  // Remove old theme class
  root.classList.remove('light', 'dark')
  // Add new theme class
  root.classList.add(theme)

  // Apply CSS variables
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value)
  })

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
