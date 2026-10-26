import { useI18n } from '../i18n'
import { useTheme } from '../hooks/useTheme'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const i18n = useI18n()
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="p-2 hover:bg-accent rounded-lg transition-colors text-foreground"
      title={theme === 'light' ? i18n.t("切换到暗色模式") : i18n.t("切换到亮色模式")}
      aria-label={i18n.t("切换主题")}
    >
      {theme === 'light' ? (
        <Moon className="w-5 h-5" />
      ) : (
        <Sun className="w-5 h-5" />
      )}
    </button>
  )
}

