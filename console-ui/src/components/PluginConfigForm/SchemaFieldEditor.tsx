import { useId } from 'react'
import { ConversationScopeEditor } from './ConversationScopeEditor'
import { isConversationScopeField } from './conversation-scope-model.mjs'
import type { SchemaField } from './types.js'
import { objectFields, declaredDefaults, updateObjectField, updateListItem, numericDraft } from './schema-model.mjs'
import { numericFieldIssue } from './numeric-validation.mjs'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export function SchemaFieldEditor({ name, field, value, onChange, allowEnvironmentReferences = true }: {
  name: string; field: SchemaField; value: unknown; onChange: (value: unknown) => void; allowEnvironmentReferences?: boolean
}) {
  const id = useId()
  const conversationScope = isConversationScopeField(field)
  const numeric = field.type === 'number' || field.type === 'integer'
  const numericIssue = numeric && !(typeof value === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) ? numericFieldIssue({ ...field, integer: field.integer || field.type === 'integer' }, value) : null
  if (field.hidden) return null
  const secret = field.secret || field.component === 'password'
  const options = field.options ?? field.enum?.map(option => ({ label: String(option), value: option }))
  const optionIndex = options?.findIndex(option => JSON.stringify(option.value) === JSON.stringify(value)) ?? -1
  const preservedOption = !!options?.length && value !== undefined && optionIndex < 0
  const environmentOption = allowEnvironmentReferences && typeof value === 'string' && value.includes('${')
  const preservedLabel = environmentOption ? '环境变量引用（原样保留）' : '现有值不在选项中（原样保留）'
  return <div className="space-y-2 rounded-md border p-3">
    <label htmlFor={id} className="text-sm font-medium">{field.key ?? name}{field.required ? <span className="ml-1 text-destructive">必填</span> : null}</label>
    {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
    {Object.hasOwn(field, 'default') ? <p className="text-xs text-muted-foreground">{secret ? '已声明默认值' : `声明默认值：${JSON.stringify(field.default)}`}</p> : null}
    {secret ? <p className="text-xs text-muted-foreground">{allowEnvironmentReferences ? <>建议填写环境变量引用，如 {'${API_KEY}'}；不要将密钥写入配置。</> : '请按任务提供方要求填写；此处不解析环境变量引用。'}</p> : null}
    {conversationScope ? <ConversationScopeEditor field={field} value={value} onChange={onChange} /> : options?.length ? <Select value={preservedOption ? 'preserved' : value === undefined ? '' : String(optionIndex)} onValueChange={index => {
      if (!/^(0|[1-9]\d*)$/.test(index)) return
      const option = options[Number(index)]
      if (option) onChange(structuredClone(option.value))
    }}>
      <SelectTrigger id={id}><SelectValue placeholder="请选择" /></SelectTrigger>
      <SelectContent>{preservedOption ? <SelectItem value="preserved" disabled>{preservedLabel}</SelectItem> : null}{options.map((option, index) => <SelectItem key={index} value={String(index)}>{option.label}</SelectItem>)}</SelectContent>
    </Select> : field.type === 'object' ? <div className="space-y-2 border-l pl-3">
      {value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(objectFields(field)).map(([key, child]) => <SchemaFieldEditor key={key} name={key} field={child} value={(value as Record<string, unknown>)[key]} allowEnvironmentReferences={allowEnvironmentReferences} onChange={next => onChange(updateObjectField(value, key, next))} />)
        : <Button id={id} type="button" variant="outline" size="sm" onClick={() => onChange(declaredDefaults(field, {}))}>添加对象配置</Button>}
    </div> : field.type === 'list' ? <div className="space-y-2">
      {Array.isArray(value) ? value.map((item, index) => <div key={index} className="space-y-1">
        <SchemaFieldEditor name={`${name} 第 ${index + 1} 项`} field={field.inner!} value={item} allowEnvironmentReferences={allowEnvironmentReferences} onChange={next => onChange(updateListItem(value, index, next))} />
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(value.filter((_, i) => i !== index))}>删除此项</Button>
      </div>) : null}
      <Button id={id} type="button" variant="outline" size="sm" onClick={() => onChange([...(Array.isArray(value) ? value : []), declaredDefaults(field.inner!, field.inner?.type === 'object' ? {} : field.inner?.type === 'list' ? [] : undefined) ?? (field.inner?.type === 'boolean' ? false : field.inner?.type === 'number' ? undefined : '')])}>添加列表项</Button>
    </div> : field.type === 'boolean' ? <div className="flex items-center gap-2"><Switch id={id} checked={value === true} onCheckedChange={onChange} /><span className="text-sm">{value === undefined ? '尚未设置' : value ? '已启用' : '已禁用'}</span></div>
      : field.type === 'const' ? <p id={id} className="text-sm">{JSON.stringify(value ?? field.default)}（固定值）</p>
      : field.type === 'number' || field.type === 'integer' ? <Input id={id} type={field.secret ? 'password' : 'text'} aria-invalid={!!numericIssue} inputMode="decimal" value={value === undefined ? '' : String(value)} onChange={event => onChange(numericDraft(event.target.value))} placeholder={allowEnvironmentReferences ? '数字或 ${ENV_NAME}' : '填写数字'} />
      : field.component === 'textarea' ? <Textarea id={id} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} />
      : <Input id={id} type={field.secret || field.component === 'password' ? 'password' : 'text'} autoComplete="off" value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} />}
    {preservedOption ? <p className="break-all text-xs text-muted-foreground">{environmentOption ? '当前为环境变量引用，展开值未读取。' : <>当前保存值不在选项中{secret ? '。' : `：${JSON.stringify(value)?.slice(0, 200)}${(JSON.stringify(value)?.length ?? 0) > 200 ? '…' : ''}。`}</>}未选择替换时会原样保留；可明确选择新值，或打开完整源码编辑。保存仍需 Host 校验。</p> : null}
    {numericIssue ? <p role="alert" className="text-xs text-destructive">{numericIssue}；以 Host 校验结果为准。</p> : null}
    {!conversationScope && field.type !== 'const' && value !== undefined ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>取消此项设置{Object.hasOwn(field, 'default') ? '（使用声明默认值）' : ''}</Button> : null}
  </div>
}
