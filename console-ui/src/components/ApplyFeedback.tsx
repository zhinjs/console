import { RotateCw } from 'lucide-react'
import { useI18n } from '../i18n'
import type { ConfigurationRuntimeStatus } from './PluginConfigForm/config-live-status.mjs'

export interface ApplyFeedbackValue {
  kind: 'saved' | 'conflict' | 'invalid' | 'error'
  text: string
  restartRequired?: boolean
  applicationKind?: ConfigurationRuntimeStatus['kind']
}

/** Save-then-apply receipt shown next to a Save button (saved / applied / needs restart / failed). */
export function ApplyFeedback({ feedback }: { feedback: ApplyFeedbackValue }) {
  const i18n = useI18n()
  if (feedback.kind === 'saved') {
    const tone = feedback.applicationKind === 'applied' ? 'text-success'
      : feedback.applicationKind === 'failed' ? 'text-destructive'
        : feedback.restartRequired || feedback.applicationKind ? 'text-warning' : 'text-muted-foreground'
    return <span className="flex items-center gap-1 text-sm">
      {feedback.restartRequired && <RotateCw className="size-4 text-warning" />}
      <span className={tone}>{i18n.t('保存回执：{0}', [feedback.text])}</span>
    </span>
  }
  return <span className="text-sm text-destructive">{feedback.text}</span>
}
