import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Monitor, Moon, Palette, Sun, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'
import { useTheme } from '../hooks/useTheme'
import type { ThemeMode } from '../theme'
import { ThemeToggle } from './ThemeToggle'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'

/**
 * The top bar's account menu: 个人设置, 界面语言, 显示模式, the full appearance panel and 退出登录 in
 * one labelled button instead of four unlabelled icons. The appearance panel (palettes) opens
 * anchored to the same button.
 */
export function UserMenu({ accountLabel, accountHref, onSignOut }: { accountLabel: string; accountHref?: string; onSignOut: () => void }) {
  const i18n = useI18n()
  const { locale, setLocale } = i18n
  const { theme, mode, setMode } = useTheme()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const label = i18n.t('用户菜单：{0}', [accountLabel])
  const modes = [
    { id: 'light' as const, label: i18n.t('亮色'), icon: Sun },
    { id: 'dark' as const, label: i18n.t('暗色'), icon: Moon },
    { id: 'system' as const, label: i18n.t('跟随系统'), icon: Monitor },
  ]
  const menu = (
    <span className="console-user-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="console-topnav-account console-user-menu-trigger" aria-label={label} data-tooltip={i18n.t('账号、语言与外观')}>
            <UserRound aria-hidden="true" />
            <span className="console-user-menu-name">{accountLabel}</span>
            <ChevronDown className="console-user-menu-chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="console-user-menu-content">
          <DropdownMenuLabel className="console-user-menu-heading">
            <span>{i18n.t('当前身份')}</span>
            <strong>{accountLabel}</strong>
          </DropdownMenuLabel>
          {accountHref ? (
            <DropdownMenuItem asChild><Link to={accountHref}><UserRound aria-hidden="true" />{i18n.t('个人设置')}</Link></DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="console-user-menu-section">{i18n.t('界面语言')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={locale} onValueChange={value => { if (isLocale(value)) setLocale(value) }}>
            <DropdownMenuRadioItem value="zh-CN">{i18n.t('简体中文')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="console-user-menu-section">{i18n.t('显示模式')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as ThemeMode)}>
            {modes.map(item => <DropdownMenuRadioItem key={item.id} value={item.id}><item.icon aria-hidden="true" />{item.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {/* The menu closes first and returns focus to its button; then the panel opens next to it. */}
          <DropdownMenuItem onSelect={() => { window.setTimeout(() => setAppearanceOpen(true), 0) }}>
            <Palette aria-hidden="true" />{i18n.t('外观与配色…')}
            <span className="console-user-menu-hint" aria-hidden="true">{theme === 'dark' ? <Moon /> : <Sun />}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut} className="console-user-menu-signout"><LogOut aria-hidden="true" />{i18n.t('退出登录')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
  return <ThemeToggle open={appearanceOpen} onOpenChange={setAppearanceOpen} anchor={menu} />
}
