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
      <PageHeader title={i18n.t("AI 与模型")} description={i18n.t("模型账号、服务与用途；每个模型下写明哪些用途在用它。")} />
      <InferenceWorkspace key={scope ?? 'disconnected'} connectionScope={scope} />
    </PageShell>
  )
}
