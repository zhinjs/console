import { useId } from 'react'
import { Moon, Sun, Monitor, Palette, RotateCcw, Check } from 'lucide-react'
import { useI18n } from '../i18n'
import { useTheme } from '../hooks/useTheme'
import { THEME_PALETTES, type ThemeMode } from '../theme'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import '../theme/appearance.css'

export function ThemeToggle() {
  const i18n = useI18n()
  const { theme, mode, palette, setMode, setPalette, resetTheme } = useTheme()
  const id = useId()
  const modes = [
    { id: 'light' as const, label: i18n.t('亮色'), icon: Sun },
    { id: 'dark' as const, label: i18n.t('暗色'), icon: Moon },
    { id: 'system' as const, label: i18n.t('跟随系统'), icon: Monitor },
  ]
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="console-icon-button console-theme-trigger" title={i18n.t('外观与主题')} aria-label={i18n.t('切换主题')}>{theme === 'dark' ? <Moon /> : <Sun />}<span className="console-theme-trigger-dot" aria-hidden="true" /></button></PopoverTrigger>
    <PopoverContent align="end" className="console-appearance-panel" aria-labelledby={`${id}-title`}>
      <div className="console-appearance-heading"><Palette className="h-4 w-4" aria-hidden="true" /><h2 id={`${id}-title`}>{i18n.t('外观与主题')}</h2></div>
      <fieldset className="console-appearance-section"><legend>{i18n.t('显示模式')}</legend><div className="console-appearance-modes">
        {modes.map(item => <label key={item.id} className="console-mode-choice">
          <input type="radio" name={`${id}-mode`} value={item.id} checked={mode === item.id} onChange={() => setMode(item.id as ThemeMode)} />
          <span><item.icon aria-hidden="true" />{item.label}</span>
        </label>)}
      </div></fieldset>
      <fieldset className="console-appearance-section"><legend>{i18n.t('配色方案')}</legend><div className="console-appearance-palettes">
        {THEME_PALETTES.map(item => <label key={item.id} className="console-palette-choice">
          <input type="radio" name={`${id}-palette`} value={item.id} checked={palette === item.id} onChange={() => setPalette(item.id)} />
          <span><span className="console-palette-swatch" style={{ backgroundColor: item.swatch }} aria-hidden="true" />{i18n.t(item.label)}<Check className="console-palette-check" aria-hidden="true" /></span>
        </label>)}
      </div></fieldset>
      <div className="console-appearance-footer"><p>{i18n.t('立即预览，仅保存在当前浏览器。')}</p><button type="button" onClick={resetTheme}><RotateCcw aria-hidden="true" />{i18n.t('恢复默认外观')}</button></div>
    </PopoverContent>
  </Popover>
}
