import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Rocket, ShieldAlert, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { useConsoleSession } from '../hooks/use-console-session'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { currentOnboarding, requestSetup } from '../utils/console-session.mjs'
import { onboardingIncomplete } from '../utils/console-auth-model.mjs'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import '../pages/onboarding/onboarding.css'

/**
 * Entry banner while onboarding is incomplete (ADR 0053 §2), and on an open local Host that
 * has no owner yet (ADR 0049: create one to turn on sign-in). Dismissed for this page load only.
 */
export function OnboardingBanner() {
  const i18n = useI18n()
  const location = useLocation()
  const session = useConsoleSession()
  const access = useConsoleAccess()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || location.pathname === CONSOLE_PATHS.onboarding) return null

  const me = session.me
  if (me?.kind === 'bootstrap' && me.open && me.setupRequired) {
    return <div className="console-onboarding-banner" role="region" aria-label={i18n.t('初始化')}>
      <ShieldAlert aria-hidden="true" />
      <span>{i18n.t('这台 Host 没有设置访问令牌，也还没有所有者：任何能访问它的人都有全部权限。创建所有者后改用账号登录。')}</span>
      <Button size="sm" onClick={() => requestSetup(true)}>{i18n.t('创建所有者')}</Button>
      <Button size="icon" variant="ghost" aria-label={i18n.t('暂时隐藏')} onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>
    </div>
  }

  if (!onboardingIncomplete(currentOnboarding(session)) || !hasConsolePermission('plugin.manage', access)) return null
  return <div className="console-onboarding-banner" role="region" aria-label={i18n.t('引导')}>
    <Rocket aria-hidden="true" />
    <span>{i18n.t('还有几步就能让机器人上线：接入 AI 和聊天平台。')}</span>
    <Button asChild size="sm"><Link to={CONSOLE_PATHS.onboarding}>{i18n.t('继续引导')}</Link></Button>
    <Button size="icon" variant="ghost" aria-label={i18n.t('暂时隐藏')} onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>
  </div>
}
