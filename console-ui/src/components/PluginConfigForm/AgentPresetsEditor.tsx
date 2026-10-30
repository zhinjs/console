import { useI18n } from '../../i18n'
import { SelectField } from '../ui/select'
import { SchemaFieldEditor } from './SchemaFieldEditor'
import { objectFields, updateObjectField } from './schema-model.mjs'
import type { SchemaField, SchemaEditorDrafts } from './types'
import { deploymentPresetChoices, selectAgentPreset } from '../../pages/model-policy-model.mjs'

export function AgentPresetsEditor({ value, field, ai, onChange, drafts, onValidityChange }: {
  value: unknown; field: SchemaField; ai: unknown; onChange(value: unknown): void;
  drafts: SchemaEditorDrafts; onValidityChange(path: string, invalid: boolean): void
}) {
  const i18n = useI18n()
  const agents = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const choices = deploymentPresetChoices(ai)
  const roleSchema = (field.inner || field.additional || { type: 'object', object: {} }) as SchemaField
  const fields = Object.fromEntries(Object.entries(objectFields(roleSchema)).filter(([key]) => !['provider', 'model', 'preset'].includes(key)))
  return <div className="space-y-4" aria-label={i18n.t('Agent 预设')}>
    {Object.entries(agents).map(([name, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return <SchemaFieldEditor key={name} name={name} field={roleSchema} value={raw} onChange={next => onChange(updateObjectField(agents, name, next))} />
      const role = raw as Record<string, unknown>
      const { provider, model, preset, ...authority } = role
      const refs = { ...(provider !== undefined ? { provider } : {}), ...(model !== undefined ? { model } : {}), ...(preset !== undefined ? { preset } : {}) }
      const options = [{ value: '', label: provider || model ? `${String(provider ?? '')} / ${String(model ?? '')}` : i18n.t('选择模型预设'), disabled: true },
        ...choices.map(item => ({ value: item.id, label: `${item.id} · ${item.model} (${item.sdk})`, disabled: false }))]
      if (typeof preset === 'string' && !options.some(option => option.value === preset)) options.push({ value: preset, label: preset, disabled: false })
      return <section key={name} className="space-y-3 border-b pb-4">
        <h4 className="font-medium">{name}</h4>
        <label className="block space-y-2 text-sm"><span>{i18n.t('模型预设')}</span><SelectField aria-label={`${name} ${i18n.t('模型预设')}`} value={typeof preset === 'string' ? preset : ''} options={options} onValueChange={next => onChange(selectAgentPreset(agents, name, next))} /></label>
        <SchemaFieldEditor name={i18n.t('角色设置')} path={`$/agents/${JSON.stringify(name)}/authority`} field={{ type: 'object', object: fields, additional: false }} value={authority}
          onChange={next => onChange(updateObjectField(agents, name, { ...refs, ...(next as Record<string, unknown>) }))} drafts={drafts} onValidityChange={onValidityChange} />
      </section>
    })}

  </div>
}
