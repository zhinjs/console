import { useI18n } from '../../i18n'
import { useCallback, useRef } from 'react'
import { SchemaFieldEditor } from '../../components/PluginConfigForm/SchemaFieldEditor'
import type { SchemaEditorDrafts } from '../../components/PluginConfigForm/types'
import { schemaField, type ObjectValue } from './model.mjs'

/** Display metadata only; the held Driver remains the sole validator and source of defaults. */
export function SchemaFields({
  schema,
  value,
  onChange,
  onValidityChange,
}: {
  schema?: Record<string, unknown>
  value: ObjectValue
  onChange: (value: ObjectValue) => void
  onValidityChange?: (valid: boolean) => void
}) {
  const i18n = useI18n()
  const drafts = useRef<SchemaEditorDrafts>({ json: new Map(), unions: new Map() }),
    invalid = useRef(new Set<string>())
  const validity = useCallback(
    (path: string, error: boolean) => {
      if (error) invalid.current.add(path)
      else invalid.current.delete(path)
      onValidityChange?.(!invalid.current.size)
    },
    [onValidityChange]
  )
  return (
    <SchemaFieldEditor
      name={i18n.t("参数")}
      field={schemaField(schema ?? { type: 'object', properties: {} })}
      value={value}
      onChange={(next) => onChange(next as ObjectValue)}
      drafts={drafts.current}
      onValidityChange={validity}
      allowEnvironmentReferences={false}
      useDeclaredDefaults={true}
      clearable={false}
    />
  )
}
