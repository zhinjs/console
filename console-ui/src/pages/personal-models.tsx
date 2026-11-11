import { useI18n } from '../i18n'
import { PageShell } from '../components/PageShell'
import { PageHeader } from '../components/PageHeader'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { InferenceWorkspace } from './inference/Workspace'

export default function PersonalModelsPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  return (
    <PageShell>
      <PageHeader title={i18n.t("模型", undefined, 'plural')} />
      <InferenceWorkspace key={scope ?? 'disconnected'} connectionScope={scope} />
    </PageShell>
  )
}
