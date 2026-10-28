import { useI18n } from '../i18n'
import { useTheme } from '../hooks/useTheme'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const i18n = useI18n()
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="console-icon-button"
      title={theme === 'light' ? i18n.t("切换到暗色模式") : i18n.t("切换到亮色模式")}
      aria-label={i18n.t("切换主题")}
    >
      {theme === 'light' ? (
        <Moon />
      ) : (
        <Sun />
      )}
    </button>
  )
}

