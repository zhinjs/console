import { useI18n } from '../../i18n'
import { SchemaFieldEditor } from './SchemaFieldEditor'
import { objectFields, updateObjectField } from './schema-model.mjs'
import type { SchemaField, SchemaEditorDrafts } from './types'

export function AgentPresetsEditor({ value, field, onChange, drafts, onValidityChange }: {
  value: unknown; field: SchemaField; ai: unknown; onChange(value: unknown): void;
  drafts: SchemaEditorDrafts; onValidityChange(path: string, invalid: boolean): void
}) {
  const i18n = useI18n()
  const agents = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const roleSchema = (field.inner || field.additional || { type: 'object', object: {} }) as SchemaField
  const fields = Object.fromEntries(Object.entries(objectFields(roleSchema)).filter(([key]) => !['provider', 'model', 'preset'].includes(key)))
  return <div className="space-y-4" aria-label={i18n.t('Agent 预设')}>
    {Object.entries(agents).map(([name, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return <SchemaFieldEditor key={name} name={name} field={roleSchema} value={raw} onChange={next => onChange(updateObjectField(agents, name, next))} />
      const role = raw as Record<string, unknown>
      return <section key={name} className="space-y-3 border-b pb-4">
        <h4 className="font-medium">{name}</h4>
        <SchemaFieldEditor name={i18n.t('角色设置')} path={`$/agents/${JSON.stringify(name)}/authority`} field={{ type: 'object', object: fields, additional: false }} value={role}
          onChange={next => onChange(updateObjectField(agents, name, next))} drafts={drafts} onValidityChange={onValidityChange} />
      </section>
    })}

  </div>
}
