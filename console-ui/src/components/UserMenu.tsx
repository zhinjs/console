import { Link } from 'react-router-dom'
import { LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'
import { useTheme } from '../hooks/useTheme'
import type { ThemeMode } from '../theme'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton } from '@zhin.js/console-ui'

/**
 * The top bar's account menu: 个人设置, 界面语言, 显示模式 (浅色 / 深色 / 跟随系统) and 退出登录 in
 * one round button. console-ui 1.3.0 has one set of colors, so the three modes are the whole
 * appearance setting.
 */
export function UserMenu({ accountLabel, accountHref, onSignOut }: { accountLabel: string; accountHref?: string; onSignOut: () => void }) {
  const i18n = useI18n()
  const { locale, setLocale } = i18n
  const { mode, setMode } = useTheme()
  const label = i18n.t('用户菜单：{0}', [accountLabel])
  const modes = [
    { id: 'light' as const, label: i18n.t('浅色'), icon: Sun },
    { id: 'dark' as const, label: i18n.t('深色'), icon: Moon },
    { id: 'system' as const, label: i18n.t('跟随系统'), icon: Monitor },
  ]
  return (
    <span className="console-user-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton className="console-user-menu-trigger" aria-label={label} title={i18n.t('账号、语言与外观')}>
            <span className="console-user-menu-initial" aria-hidden="true">{accountInitial(accountLabel)}</span>
          </IconButton>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="danger" onSelect={onSignOut} className="console-user-menu-signout"><LogOut aria-hidden="true" />{i18n.t('退出登录')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/** The first letter of the account (the round account button, like the design's 「L」). */
export function accountInitial(label: string): string {
  const first = Array.from(label.trim())[0]
  return first ? first.toLocaleUpperCase() : '?'
}
