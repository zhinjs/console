import { AlertCircle, Lock } from 'lucide-react'
import { Alert, AlertDescription, Button, Card, CardContent, Skeleton } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import { StatusState } from '../../components/StatusState'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { SCOPE_LEVEL_LABELS } from '../../scope/scope-tree.mjs'
import { featureFieldRows, jsonSchemaToField } from './feature-model.mjs'
import { featureValueText } from './feature-scope-model.mjs'
import { globalConfigDeniedMessage, globalConfigReadOnlyNote, globalConfigUnsupportedMessage } from './global-config-model.mjs'
import { useGlobalFeatureDetail } from './use-feature-data'
import './feature-level-panel.css'

/** Shown instead of the editor to identities that may not read the configuration source. */
export function GlobalConfigDenied() {
  const i18n = useI18n()
  return <Alert role="status"><Lock className="h-4 w-4" /><AlertDescription>{globalConfigDeniedMessage(i18n.t)}</AlertDescription></Alert>
}

/**
 * Read-only effective global configuration (`feature.get { level: 'global' }`, secrets masked by the
 * Host) for identities without `ops.config.read`. Lower-level overrides are listed by the summary card.
 */
export function GlobalConfigReadOnly({ plugin }: { plugin: string }) {
  const i18n = useI18n()
  const detail = useGlobalFeatureDetail(plugin)
  const note = <Alert role="status"><Lock className="h-4 w-4" /><AlertDescription>{globalConfigReadOnlyNote(i18n.t)}</AlertDescription></Alert>
  if (detail.status === 'forbidden') return <GlobalConfigDenied />
  if (detail.status === 'unsupported') return <Alert role="status"><AlertCircle className="h-4 w-4" /><AlertDescription>{globalConfigUnsupportedMessage(i18n.t)}</AlertDescription></Alert>
  if (!detail.value) {
    if (detail.status === 'error') {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{readErrorSummary(detail.error, i18n.t("配置"), i18n.locale)}</p>
            <Button variant="secondary" size="sm" onClick={detail.refresh}>{i18n.t("重试读取")}</Button>
          </AlertDescription>
        </Alert>
      )
    }
    return <>{note}<StatusState kind="loading" onRetry={detail.refresh} placeholder={<Skeleton className="h-48" />} /></>
  }
  const rows = featureFieldRows(detail.value)
  const copy = { unset: i18n.t('未设置'), masked: i18n.t('已隐藏的敏感值') }
  return (
    <>
      {note}
      <Card>
        <CardContent className="p-4">
          {rows.length ? (
            <div className="console-feature-fields is-global" role="table" aria-label={i18n.t('{0} 的字段', [plugin])}>
              <div className="console-feature-field is-head" role="row">
                <span role="columnheader">{i18n.t('字段')}</span>
                <span role="columnheader">{i18n.t('有效值')}</span>
                <span role="columnheader">{i18n.t('来源')}</span>
              </div>
              {rows.map(field => {
                const title = jsonSchemaToField(field.schema).title ?? field.name
                return (
                  <div key={field.name} role="rowgroup" className="console-feature-field-group">
                    <div className="console-feature-field" role="row">
                      <span role="cell" className="console-feature-field-name" data-label={i18n.t('字段')}>
                        <span className="font-medium">{title}</span>
                        {title !== field.name ? <code>{field.name}</code> : null}
                      </span>
                      <span role="cell" data-label={i18n.t('有效值')} className="console-feature-value is-strong">{featureValueText(field.effective, copy)}</span>
                      <span role="cell" data-label={i18n.t('来源')} className="text-muted-foreground">{field.source ? i18n.t(SCOPE_LEVEL_LABELS[field.source]) : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p className="console-feature-note">{i18n.t('这个功能没有可配置的字段，只有开关。')}</p>}
        </CardContent>
      </Card>
    </>
  )
}
