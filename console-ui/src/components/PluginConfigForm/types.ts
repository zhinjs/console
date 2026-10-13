/**
 * PluginConfigForm 类型定义
 */

export interface SchemaField {
  key?: string
  type: string
  description?: string
  default?: any
  required?: boolean
  enum?: any[]
  integer?: boolean
  min?: number
  max?: number
  step?: number  // 用于 percent 类型
  pattern?: string
  inner?: SchemaField  // 用于 list/dict 类型
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
  options?: ReadonlyArray<{ label: string; value: unknown }>
}

export interface Schema {
  type: string
  object?: Record<string, SchemaField>
  properties?: Record<string, SchemaField>
  dict?: Record<string, SchemaField>
  description?: string
}

export interface PluginConfigFormProps {
  pluginName: string
  schema: Schema | null
  initialConfig?: Record<string, any>
  onSuccess?: () => void
}
