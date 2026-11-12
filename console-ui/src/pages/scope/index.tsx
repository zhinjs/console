import { useLocation } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { StatusState } from '../../components/StatusState'
import { parseScopePath, scopeKey, type Scope } from '../../scope/scope-tree.mjs'
import { GlobalObjectPage } from './global-page'
import { AdapterObjectPage } from './adapter-page'
import { EndpointObjectPage } from './endpoint-page'
import { ConversationObjectPage, InvalidConversationPage } from './conversation-page'

/**
 * Element of every object-tree route (`/scope`, `/scope/:adapter`, `/scope/:adapter/:endpoint`,
 * `/scope/:adapter/:endpoint/:conversation`). The raw path is parsed (not `useParams`) so ids with
 * `/` or `%` stay exact; each object gets a fresh page state.
 */
export default function ScopeObjectRoute() {
  const i18n = useI18n()
  const { pathname } = useLocation()
  const parsed = parseScopePath(pathname)
  if (!parsed) {
    return <PageShell><StatusState kind="error" title={i18n.t('地址无效')} description={pathname} /></PageShell>
  }
  if (!parsed.ok) return <PageShell><InvalidConversationPage scope={parsed.scope} segment={parsed.segment} /></PageShell>
  const scope = parsed.scope
  const identity = `${scope.level}\u0000${scopeKey(scope) ?? pathname}`
  return <ScopeObject key={identity} scope={scope} />
}

function ScopeObject({ scope }: { scope: Scope }) {
  if (scope.level === 'adapter') return <AdapterObjectPage scope={scope as Scope & { level: 'adapter' }} />
  if (scope.level === 'endpoint') return <EndpointObjectPage scope={scope as Scope & { level: 'endpoint' }} />
  if (scope.level === 'conversation') return <ConversationObjectPage scope={scope as Scope & { level: 'conversation' }} />
  return <GlobalObjectPage />
}
