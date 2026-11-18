import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Monitor, Moon, Palette, Sun, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'
import { useTheme } from '../hooks/useTheme'
import type { ThemeMode } from '../theme'
import { ThemeToggle } from './ThemeToggle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@zhin.js/console-ui'

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
  // Set by the 「外观与配色…」 item; the panel opens once the menu has fully closed (onCloseAutoFocus).
  const openAppearanceAfterClose = useRef(false)
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
        <DropdownMenuContent
          align="end"
          className="console-user-menu-content"
          onCloseAutoFocus={event => {
            if (!openAppearanceAfterClose.current) return
            // Opening the panel from onSelect (even after a timeout) races the menu's own dismissal:
            // a slow mouse press still has the pointer down when the panel mounts, and its
            // pointerup / focus restore counts as an outside interaction that closes the panel at once.
            // Waiting for the menu to finish closing, and keeping focus off the trigger, avoids both.
            openAppearanceAfterClose.current = false
            event.preventDefault()
            setAppearanceOpen(true)
          }}
        >
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
          {/* The menu closes first; onCloseAutoFocus above then opens the panel next to the same button. */}
          <DropdownMenuItem onSelect={() => { openAppearanceAfterClose.current = true }}>
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
