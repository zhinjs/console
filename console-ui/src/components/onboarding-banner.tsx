import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Rocket, ShieldAlert, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { Banner, Button, IconButton } from '@zhin.js/console-ui'
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
    // Soft-card banner: one short state and one white button; the risk itself (no token, no owner:
    // full access for anyone who can reach the Host) is the detail line.
    return <section className="console-onboarding-banner" aria-label={i18n.t('初始化')}>
      <Banner tone="danger" icon={<ShieldAlert aria-hidden="true" />}
        action={<><Button size="sm" variant="white" onClick={() => requestSetup(true)}>{i18n.t('创建所有者')}</Button>
          <IconButton variant="flat" aria-label={i18n.t('暂时隐藏')} onClick={() => setDismissed(true)}><X aria-hidden="true" /></IconButton></>}>
        {i18n.t('还没有所有者')}
        <span className="console-banner-detail"> · {i18n.t('没有访问令牌也没有所有者，任何能访问的人都有全部权限')}</span>
      </Banner>
    </section>
  }

  if (!onboardingIncomplete(currentOnboarding(session)) || !hasConsolePermission('plugin.manage', access)) return null
  return <section className="console-onboarding-banner" aria-label={i18n.t('引导')}>
    <Banner tone="warn" icon={<Rocket aria-hidden="true" />}
      action={<><Button asChild size="sm" variant="white"><Link to={CONSOLE_PATHS.onboarding}>{i18n.t('继续引导')}</Link></Button>
        <IconButton variant="flat" aria-label={i18n.t('暂时隐藏')} onClick={() => setDismissed(true)}><X aria-hidden="true" /></IconButton></>}>
      {i18n.t('机器人还没上线')}
    </Banner>
  </section>
}
