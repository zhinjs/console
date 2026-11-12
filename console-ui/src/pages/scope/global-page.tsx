import { Globe2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { ObjectPageLayout } from '../../scope/ObjectPageLayout'
import { ChatRolesPanel } from '../../scope/ChatRolesPanel'
import { GlobalFeaturesPanel } from '../features/global-features-panel'
import { GlobalOverview } from './overview-panels'
import { ScopeRecordsPanel } from './scope-panels'

const GLOBAL = { level: 'global' } as const

/**
 * `/scope` — 全局: every adapter and account with logins waiting and where to connect a new
 * platform (概览), every feature with where lower levels change it (功能, the matrix is its second
 * view), global chat roles (角色) and records (记录).
 */
export function GlobalObjectPage() {
  const i18n = useI18n()
  return (
    <ObjectPageLayout
      scope={GLOBAL}
      title={i18n.t('全局')}
      description={i18n.t('所有适配器、账号与会话。在这里设置的功能与角色对下级全部生效，除非下级另有覆盖。')}
      icon={Globe2}
      panels={{
        overview: <GlobalOverview />,
        features: <GlobalFeaturesPanel />,
        roles: <ChatRolesPanel scope={GLOBAL} />,
        records: <ScopeRecordsPanel scope={GLOBAL} />,
      }}
    />
  )
}
