/**
 * PluginConfigForm 类型定义
 */

export interface SchemaField {
  /** Host-authored display metadata; option values remain unchanged. */
  'x-i18n'?: Readonly<{ en?: Readonly<{ title?: string; description?: string; enumLabels?: Readonly<Record<string, string>> }> }>
  key?: string
  type: string
  description?: string
  title?: string
  default?: any
  required?: boolean
  enum?: any[]
  integer?: boolean
  min?: number
  max?: number
  step?: number  // 用于 percent 类型
  pattern?: string
  inner?: SchemaField | false
  additional?: SchemaField | false
  value?: unknown
  mode?: 'anyOf' | 'oneOf'
  reason?: string
  items?: SchemaField  // 兼容旧格式
  list?: SchemaField[]  // 用于 tuple/union/intersect 类型
  properties?: Record<string, SchemaField>
  /** Schema.toJSON() object map（与 @zhin.js/schema 对齐；优先于 dict/properties） */
  object?: Record<string, SchemaField>
  dict?: Record<string, SchemaField>  // object 类型的字段
  component?: string  // Host UI 组件提示
  hidden?: boolean
  secret?: boolean
  effect?: string
  options?: ReadonlyArray<{ label: string; value: unknown; 'x-i18n'?: SchemaField['x-i18n'] }>
}

export type Schema = SchemaField

/** Owned by one scoped form; never shared between connections or aliases. */
export interface SchemaEditorDrafts {
  json: Map<string, { text: string; value: unknown; error: boolean }>
  unions: Map<string, { selected: number | undefined; values: Map<number, unknown> }>
}

export interface PluginConfigFormProps {
  pluginName: string
  schema: Schema | null
  initialConfig?: unknown
  onSuccess?: () => void
}
