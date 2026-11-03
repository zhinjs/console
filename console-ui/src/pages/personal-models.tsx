import { PageShell } from '../components/PageShell'
import { PageHeader } from '../components/PageHeader'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { InferenceWorkspace } from './inference/Workspace'

export default function PersonalModelsPage() {
  const scope = useInboxCacheScope()
  return (
    <PageShell>
      <PageHeader title="模型" />
      <InferenceWorkspace key={scope ?? 'disconnected'} connectionScope={scope} />
    </PageShell>
  )
}
