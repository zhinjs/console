import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useConsoleSession } from '../hooks/use-console-session'
import { loadConsoleSession } from '../utils/console-auth-api'
import { sessionView } from '../utils/console-auth-model.mjs'
import { requestSetup, resetConsoleSession } from '../utils/console-session.mjs'
import { notifyAuthRequired } from '../utils/auth'
import { beginOnboarding, hydrateLocalOnboarding } from '../utils/onboarding-store'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import SetupWizard from '../pages/setup/setup-wizard'

/**
 * Reads `/auth/me` before the shell mounts (ADR 0049 §5): permissions feed navigation, a
 * bootstrap token opens the setup wizard, a rejected credential returns to sign-in.
 * Hosts without `/auth/*` and unreachable Hosts render the shell unrestricted, as before.
 */
export function ConsoleSessionGate({ children }: { children: ReactNode }) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const session = useConsoleSession()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    resetConsoleSession()
    hydrateLocalOnboarding()
    void loadConsoleSession().then(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const view = session.legacy || !session.me ? 'shell' : sessionView(session.me)

  useEffect(() => {
    if (!loading && view === 'signed-out') notifyAuthRequired()
  }, [loading, view])

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-background" role="status">
      <p className="text-sm text-muted-foreground">{i18n.t('正在确认登录身份…')}</p>
    </div>
  }
  if (view === 'signed-out') return null
  if (view === 'setup' || session.setupRequested) {
    return <SetupWizard
      onCancel={session.setupRequested && view !== 'setup' ? () => requestSetup(false) : undefined}
      onComplete={() => {
        beginOnboarding()
        requestSetup(false)
        navigate(CONSOLE_PATHS.onboarding)
      }} />
  }
  return <>{children}</>
}
