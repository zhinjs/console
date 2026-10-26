import { translate } from '../../i18n/locale.mjs'
import { useI18n, localizeSchemaField } from '../../i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { ConversationScopeEditor } from './ConversationScopeEditor'
import { isConversationScopeField } from './conversation-scope-model.mjs'
import type { SchemaField, SchemaEditorDrafts } from './types.js'
import { objectFields, initialSchemaValue, matchingSchemaBranches, updateObjectField, updateListItem, numericDraft } from './schema-model.mjs'
import { CodeEditor } from '../../pages/files/code-editor'
import { numericFieldIssue } from './numeric-validation.mjs'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

interface FieldEditorProps {
  name: string; field: SchemaField; value: unknown; onChange: (value: unknown) => void; allowEnvironmentReferences?: boolean
  path?: string; drafts?: SchemaEditorDrafts; onValidityChange?: (path: string, invalid: boolean) => void
  reservedKeys?: readonly string[]
}

function jsonText(value: unknown) { return value === undefined ? '' : JSON.stringify(value, null, 2) }
function sameValue(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
function branchLabel(original: SchemaField, parent: SchemaField, i18n: ReturnType<typeof useI18n>) {
  const branch = localizeSchemaField(original, i18n.locale)
  const types: Record<string, string> = { string: i18n.t( "文本 / 环境变量"), number: i18n.t( "数字"), integer: i18n.t( "整数"), boolean: i18n.t( "开关"), object: i18n.t( "对象"), dict: i18n.t( "键值表"), list: i18n.t( "列表"), tuple: i18n.t( "固定列表"), null: i18n.t( "空值"), any: i18n.t( "JSON 值") }
  const kind = branch.type === 'const' ? JSON.stringify(Object.hasOwn(branch, 'value') ? branch.value : branch.default) : types[branch.type] ?? branch.type
  const title = branch.title ?? (branch.description !== parent.description ? branch.description : undefined)
  return title ? `${title}（${kind}）` : kind
}
function inheritedField(parent: SchemaField, child: SchemaField): SchemaField { return parent.secret ? { ...child, secret: true } : child }

/** Explicit removal discards only that value's cached drafts, including nested branch and JSON state. */
function clearEditorDraftSubtree(path: string, drafts?: SchemaEditorDrafts, onValidityChange?: FieldEditorProps['onValidityChange']) {
  for (const key of drafts?.json.keys() ?? []) if (key === path || key.startsWith(`${path}/`)) { drafts?.json.delete(key); onValidityChange?.(key, false) }
  for (const key of drafts?.unions.keys() ?? []) if (key === path || key.startsWith(`${path}/`)) drafts?.unions.delete(key)
}

/** Multiline credentials retain their exact text; revealing them requires an explicit action. */
function SecretTextEditor({ name, value, onChange, id }: FieldEditorProps & { id: string }) {
  const i18n = useI18n()
  const [reveal, setReveal] = useState(false)
  return <div className="space-y-2">{reveal ? <Textarea id={id} aria-label={i18n.t("{0} 敏感多行文本", [name])} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} /> : <p className="text-xs text-muted-foreground">{i18n.t("敏感多行文本未展示，未编辑时原样保留。")}</p>}<Button type="button" variant="outline" size="sm" onClick={() => setReveal(previous => !previous)}>{reveal ? i18n.t("隐藏敏感文本") : i18n.t("编辑敏感文本")}</Button></div>
}

/** Invalid text belongs to this field's draft; it must never silently save the last parsed value. */
function JsonValueEditor({ value, onChange, path = '$', drafts, onValidityChange, name, field }: FieldEditorProps) {
  const i18n = useI18n()
  const cached = drafts?.json.get(path)
  const [draft, setDraft] = useState(() => cached && sameValue(cached.value, value) ? cached : { text: jsonText(value), value, error: null as string | null })
  const [reveal, setReveal] = useState(!field.secret)
  const errorId = useId()
  useEffect(() => {
    if (!sameValue(draft.value, value)) setDraft({ text: jsonText(value), value, error: null })
  }, [value, draft.value])
  useEffect(() => { onValidityChange?.(path, !!draft.error); return () => onValidityChange?.(path, false) }, [path, draft.error, onValidityChange])
  if (!reveal) return <div className="space-y-2"><p className="text-xs text-muted-foreground">{i18n.t("敏感值未展示，未编辑时原样保留。")}</p><Button type="button" variant="outline" size="sm" onClick={() => setReveal(true)}>{i18n.t("编辑敏感 JSON")}</Button></div>
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">{field.reason ?? i18n.t("此字段使用 JSON 值编辑；其他字段继续使用表单。")}{field.secret ? i18n.t(" 此项可能包含敏感值，请使用环境变量引用。") : ''}</p><div className="h-44 overflow-hidden rounded-md border"><CodeEditor language="json" ariaLabel={i18n.t("{0} JSON 值", [name])} value={draft.text} invalid={!!draft.error} errorId={draft.error ? errorId : undefined} onChange={text => {
    let next: typeof draft
    try { const parsed = JSON.parse(text); next = { text, value: parsed, error: null }; onChange(parsed) }
    catch { next = { text, value, error: i18n.t("JSON 格式有误；草稿已保留，修正后才能保存。") } }
    onValidityChange?.(path, !!next.error); drafts?.json.set(path, next); setDraft(next)
  }} /></div>{draft.error && <p id={errorId} role="alert" className="text-xs text-destructive">{draft.error}</p>}{value === undefined && !draft.text && <p className="text-xs text-muted-foreground">{i18n.t("尚未设置；不编辑时保持省略。")}</p>}</div>
}

function ObjectValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { field, value, onChange, path = '$' } = props
  const [keyDraft, setKeyDraft] = useState(''), [keyError, setKeyError] = useState<string | null>(null)
  const fields = objectFields(field)
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (!object) return <div className="space-y-2">{value !== undefined && <JsonValueEditor {...props} />}<Button type="button" variant="outline" size="sm" onClick={() => onChange(initialSchemaValue(field))}>{i18n.t("添加对象配置")}</Button></div>
  const dynamic = field.type === 'dict' ? field.inner || { type: 'any' } : field.additional
  const extras = Object.keys(object).filter(key => !Object.hasOwn(fields, key))
  return <div className="space-y-3 border-l pl-3">{Object.entries(fields).map(([key, child]) => <SchemaFieldEditor {...props} key={key} path={`${path}/${JSON.stringify(key)}`} name={key} field={inheritedField(field, child)} value={object[key]} onChange={next => onChange(updateObjectField(object, key, next))} />)}
    {extras.map(key => <div key={key} className="space-y-2"><SchemaFieldEditor {...props} path={`${path}/${JSON.stringify(key)}`} name={key} field={inheritedField(field, dynamic || { type: 'any', reason: i18n.t("Schema 未声明此保存字段；原值保留，最终由 Host 校验。") })} value={object[key]} onChange={next => onChange(updateObjectField(object, key, next))} /><Button type="button" variant="outline" size="sm" onClick={() => { clearEditorDraftSubtree(`${path}/${JSON.stringify(key)}`, props.drafts, props.onValidityChange); onChange(updateObjectField(object, key, undefined)) }}>{i18n.t("删除键 ")}{key}</Button></div>)}
    {!Object.keys(fields).length && !extras.length && <p className="text-xs text-muted-foreground">{dynamic ? i18n.t("当前为空对象，可添加键值。") : i18n.t("此项无需配置字段。")}</p>}
    {dynamic && <div className="flex flex-wrap gap-2"><Input aria-label={i18n.t("新增字典键")} value={keyDraft} onChange={event => { setKeyDraft(event.target.value); setKeyError(null) }} /><Button type="button" variant="outline" size="sm" onClick={() => {
      if (!keyDraft || Object.hasOwn(object, keyDraft) || Object.hasOwn(fields, keyDraft) || props.reservedKeys?.includes(keyDraft) || ['__proto__', 'prototype', 'constructor'].includes(keyDraft)) { setKeyError(i18n.t("键不能为空、不能重复或使用保留名称。")); return }
      onChange(updateObjectField(object, keyDraft, initialSchemaValue(dynamic) ?? (dynamic.type === 'string' ? '' : dynamic.type === 'boolean' ? false : null))); setKeyDraft(''); setKeyError(null)
    }}>{i18n.t("添加键值")}</Button></div>}{keyError && <p role="alert" className="text-xs text-destructive">{keyError}</p>}
  </div>
}

function SequenceValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { value, field, onChange, name, path = '$', drafts, onValidityChange } = props
  const rows = useRef({ next: 0, ids: [] as number[] })
  const items = Array.isArray(value) ? value : []
  const fixed = field.type === 'tuple' ? field.list ?? [] : []
  const canAppend = field.type === 'list' || !!field.inner
  const indexes = Array.from({ length: Math.max(items.length, fixed.length) }, (_, i) => i)
  while (rows.current.ids.length < indexes.length) rows.current.ids.push(++rows.current.next)
  rows.current.ids.length = indexes.length
  const rowPath = (id: number) => `${path}/row:${id}`
  const remove = (index: number) => {
    const removed = rows.current.ids.splice(index, 1)[0]
    if (removed !== undefined) clearEditorDraftSubtree(rowPath(removed), drafts, onValidityChange)
    onChange(items.filter((_, i) => i !== index))
  }
  return <div className="space-y-3">{value !== undefined && !Array.isArray(value) && <JsonValueEditor {...props} />}{indexes.map(index => {
    const child = fixed[index] ?? (field.inner || { type: 'any', reason: i18n.t("此位置不在已声明元组中；原值保留，Host 负责校验。") })
    const id = rows.current.ids[index]!
    return <div key={id} className="space-y-1"><SchemaFieldEditor {...props} path={rowPath(id)} name={i18n.t("{0} 第 {1} 项", [name, index + 1])} field={inheritedField(field, child)} value={items[index]} onChange={next => onChange(updateListItem(items, index, next))} />{index >= fixed.length && <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>{i18n.t("删除此项")}</Button>}</div>
  })}{canAppend && <Button type="button" variant="outline" size="sm" onClick={() => {
    const inner = field.inner || { type: 'any' }, next = [...items]
    while (next.length < fixed.length) next.push(initialSchemaValue(fixed[next.length]!) ?? null)
    rows.current.ids.push(++rows.current.next)
    onChange([...next, initialSchemaValue(inner) ?? (inner.type === 'string' ? '' : inner.type === 'boolean' ? false : null)])
  }}>{i18n.t("添加列表项")}</Button>}</div>
}

function UnionValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { field, value, onChange, path = '$', drafts } = props
  const branches = field.list ?? []
  const local = useRef(new Map<string, { selected: number | undefined; values: Map<number, unknown> }>())
  const store = drafts?.unions ?? local.current
  if (!store.has(path)) { const matches = matchingSchemaBranches(branches, value); store.set(path, { selected: matches.length === 1 ? matches[0] : undefined, values: new Map([[-1, structuredClone(value)]]) }) }
  const current = store.get(path)!
  const [selected, setSelected] = useState(current.selected)
  return <div className="space-y-3"><label className="block text-xs">{i18n.t("填写方式")}<select className="mt-1 w-full rounded-md border bg-background p-2" aria-label={i18n.t("{0} 类型分支", [props.name])} value={selected === undefined ? 'preserved' : String(selected)} onChange={event => {
    const index = event.target.value === 'preserved' ? undefined : Number(event.target.value)
    if (index !== undefined && (!/^(0|[1-9]\d*)$/.test(event.target.value) || !branches[index])) return
    current.values.set(selected ?? -1, structuredClone(value))
    const next = current.values.has(index ?? -1) ? structuredClone(current.values.get(index ?? -1)) : index === undefined ? undefined : initialSchemaValue(branches[index])
    current.selected = index; setSelected(index); onChange(next)
  }}><option value="preserved">{i18n.t("原值 / 未选择分支（保留草稿）")}</option>{branches.map((branch, index) => <option key={index} value={String(index)}>{branchLabel(branch, field, i18n)}</option>)}</select></label><p className="text-xs text-muted-foreground">{i18n.t("切换填写方式会保留各自的草稿，保存时校验格式。")}</p>
    {selected !== undefined && branches[selected] ? <SchemaFieldEditor {...props} key={selected} path={`${path}/branch:${selected}`} field={inheritedField(field, branches[selected])} /> : <JsonValueEditor {...props} path={`${path}/unselected`} />}
  </div>
}

export function SchemaFieldEditor({ name, field: sourceField, value, onChange, allowEnvironmentReferences = true, path = '$', drafts, onValidityChange, reservedKeys }: FieldEditorProps) {
  const i18n = useI18n()
  const field = localizeSchemaField(sourceField, i18n.locale)
  const id = useId()
  const conversationScope = isConversationScopeField(field)
  const numeric = field.type === 'number' || field.type === 'integer'
  const numericIssue = numeric && !(allowEnvironmentReferences && typeof value === 'string' && value.includes('${')) ? numericFieldIssue({ ...field, integer: field.integer || field.type === 'integer' }, value, i18n.locale) : null
  if (field.hidden) return null
  const secret = field.secret || field.component === 'password'
  const options = field.options ?? field.enum?.map(option => ({ label: String(option), value: option }))
  const optionIndex = options?.findIndex(option => JSON.stringify(option.value) === JSON.stringify(value)) ?? -1
  const preservedOption = !!options?.length && value !== undefined && optionIndex < 0
  const environmentOption = allowEnvironmentReferences && typeof value === 'string' && value.includes('${')
  const preservedLabel = environmentOption ? i18n.t("环境变量引用（原样保留）") : i18n.t("现有值不在选项中（原样保留）")
  const nested = { name, field: secret ? { ...field, secret: true } : field, value, onChange, allowEnvironmentReferences, path, drafts, onValidityChange, reservedKeys }
  return <div className="space-y-2 rounded-md border p-3">
    <label htmlFor={id} className="text-sm font-medium">{field.title ?? field.key ?? name}{field.required ? <span className="ml-1 text-destructive">{i18n.t("必填")}</span> : null}</label>
    {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
    {Object.hasOwn(field, 'default') ? <p className="text-xs text-muted-foreground">{secret ? i18n.t("已声明默认值") : i18n.t("声明默认值：{0}", [JSON.stringify(field.default)])}</p> : null}
    {secret ? <p className="text-xs text-muted-foreground">{allowEnvironmentReferences ? <>{i18n.t("建议填写环境变量引用，如 ")}{'${API_KEY}'}{i18n.t("；不要将密钥写入配置。")}</> : i18n.t("请按任务提供方要求填写；此处不解析环境变量引用。")}</p> : null}
    {conversationScope ? <ConversationScopeEditor field={field} value={value} onChange={onChange} /> : field.type === 'constraint' ? <p className="text-xs text-muted-foreground">{i18n.t("此约束不提供额外输入；提交后由 Host 校验，不在此处推断通过。")}</p> : field.type === 'union' ? <UnionValueEditor {...nested} /> : field.type === 'intersect' ? <div className="space-y-3"><p className="text-xs text-muted-foreground">{i18n.t("所有约束共同适用；各组编辑同一份值，Host 最终校验。")}</p>{(field.list ?? []).map((branch, index) => <SchemaFieldEditor {...nested} key={index} path={`${path}/intersect:${index}`} field={inheritedField(field, branch)} name={branch.title ?? i18n.t("{0} 约束 {1}", [name, index + 1])} />)}</div> : options?.length ? <Select value={preservedOption ? 'preserved' : value === undefined ? '' : String(optionIndex)} onValueChange={index => {
      if (!/^(0|[1-9]\d*)$/.test(index)) return
      const option = options[Number(index)]
      if (option) onChange(structuredClone(option.value))
    }}>
      <SelectTrigger id={id}><SelectValue placeholder={i18n.t("请选择")} /></SelectTrigger>
      <SelectContent>{preservedOption ? <SelectItem value="preserved" disabled>{preservedLabel}</SelectItem> : null}{options.map((option, index) => <SelectItem key={index} value={String(index)}>{option.label}</SelectItem>)}</SelectContent>
    </Select> : field.type === 'object' || field.type === 'dict' ? <ObjectValueEditor {...nested} /> : field.type === 'list' || field.type === 'tuple' ? <SequenceValueEditor {...nested} /> : field.type === 'boolean' ? <div className="space-y-2">{value !== undefined && typeof value !== 'boolean' ? <><p className="text-xs text-muted-foreground">{i18n.t("已保存非布尔原值；不操作时保留。可在下方编辑，或明确使用开关替换。")}</p><JsonValueEditor {...nested} /></> : null}<div className="flex items-center gap-2"><Switch id={id} checked={value === true} onCheckedChange={onChange} /><span className="text-sm">{value === undefined ? i18n.t("尚未设置") : value === true ? i18n.t("已启用") : value === false ? i18n.t("已禁用") : i18n.t("原值已保留")}</span></div></div>
      : field.type === 'const' ? <div className="space-y-2"><p id={id} className="text-sm">{secret ? i18n.t("固定值未展示；当前原值保持不变。") : <>{i18n.t("当前：")}{JSON.stringify(value) ?? i18n.t("未设置")}{i18n.t("；固定值：")}{JSON.stringify(Object.hasOwn(field, 'value') ? field.value : field.default)}</>}</p>{!sameValue(value, Object.hasOwn(field, 'value') ? field.value : field.default) && <Button type="button" variant="outline" size="sm" onClick={() => onChange(structuredClone(Object.hasOwn(field, 'value') ? field.value : field.default))}>{i18n.t("使用固定值")}</Button>}</div>
      : field.type === 'null' ? <div className="space-y-2"><p>{i18n.t("当前：")}{secret && value !== null && value !== undefined ? i18n.t("敏感原值未展示") : JSON.stringify(value) ?? i18n.t("未设置")}</p>{value !== null && <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>{i18n.t("设为 null")}</Button>}</div>
      : field.type === 'number' || field.type === 'integer' ? value !== undefined && typeof value !== 'number' && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : <Input id={id} type={field.secret ? 'password' : 'text'} aria-invalid={!!numericIssue} inputMode="decimal" value={value === undefined ? '' : String(value)} onChange={event => onChange(numericDraft(event.target.value))} placeholder={allowEnvironmentReferences ? i18n.t("数字或 ${ENV_NAME}") : i18n.t("填写数字")} />
      : field.component === 'textarea' ? value !== undefined && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : secret ? <SecretTextEditor {...nested} id={id} /> : <Textarea id={id} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} />
      : field.type === 'string' ? value !== undefined && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : <Input id={id} type={field.secret || field.component === 'password' ? 'password' : 'text'} autoComplete="off" value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} /> : <JsonValueEditor {...nested} />}
    {preservedOption ? <p className="break-all text-xs text-muted-foreground">{environmentOption ? i18n.t("当前为环境变量引用，展开值未读取。") : <>{i18n.t("当前保存值不在选项中")}{secret ? '。' : `：${JSON.stringify(value)?.slice(0, 200)}${(JSON.stringify(value)?.length ?? 0) > 200 ? '…' : ''}。`}</>}{i18n.t("未选择替换时会原样保留；可明确选择新值，或打开完整源码编辑。保存仍需 Host 校验。")}</p> : null}
    {numericIssue ? <p role="alert" className="text-xs text-destructive">{numericIssue}{i18n.t("；以 Host 校验结果为准。")}</p> : null}
    {!conversationScope && !['const', 'constraint'].includes(field.type) && value !== undefined ? <Button type="button" variant="ghost" size="sm" onClick={() => { clearEditorDraftSubtree(path, drafts, onValidityChange); onChange(undefined) }}>{i18n.t("取消此项设置")}{Object.hasOwn(field, 'default') ? i18n.t("（使用声明默认值）") : ''}</Button> : null}
  </div>
}
