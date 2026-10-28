import { translate } from '../../i18n/locale.mjs'
import { useI18n, localizeSchemaField } from '../../i18n'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Eraser, Plus, Trash2, Undo2 } from 'lucide-react'
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
import { Checkbox } from '../ui/checkbox'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'

interface FieldEditorProps {
  name: string; field: SchemaField; value: unknown; onChange: (value: unknown) => void; allowEnvironmentReferences?: boolean
  path?: string; drafts?: SchemaEditorDrafts; onValidityChange?: (path: string, invalid: boolean) => void
  reservedKeys?: readonly string[]
  /** Title-row overrides used by union branches, list rows and dictionary entries. */
  label?: string; actions?: ReactNode; inheritActions?: boolean; clearable?: boolean
}

function jsonText(value: unknown) { return value === undefined ? '' : JSON.stringify(value, null, 2) }
function sameValue(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
function inheritedField(parent: SchemaField, child: SchemaField): SchemaField { return parent.secret ? { ...child, secret: true } : child }

/** Explicit removal discards only that value's cached drafts, including nested branch and JSON state. */
function clearEditorDraftSubtree(path: string, drafts?: SchemaEditorDrafts, onValidityChange?: FieldEditorProps['onValidityChange']) {
  for (const key of drafts?.json.keys() ?? []) if (key === path || key.startsWith(`${path}/`)) { drafts?.json.delete(key); onValidityChange?.(key, false) }
  for (const key of drafts?.unions.keys() ?? []) if (key === path || key.startsWith(`${path}/`)) drafts?.unions.delete(key)
}

/** Multiline credentials retain their exact text; revealing them requires an explicit action. */
function SecretTextEditor({ name, value, onChange, id, placeholder }: FieldEditorProps & { id: string; placeholder?: string }) {
  const i18n = useI18n()
  const [reveal, setReveal] = useState(false)
  return <div className="space-y-2">{reveal ? <Textarea id={id} placeholder={placeholder} aria-label={i18n.t("{0} 敏感多行文本", [name])} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} /> : <p className="text-xs text-muted-foreground">{i18n.t("敏感多行文本未展示，未编辑时原样保留。")}</p>}<Button type="button" variant="outline" size="sm" onClick={() => setReveal(previous => !previous)}>{reveal ? i18n.t("隐藏敏感文本") : i18n.t("编辑敏感文本")}</Button></div>
}

/** Invalid text belongs to this field's draft; it must never silently save the last parsed value. */
function JsonValueEditor({ value, onChange, path = '$', drafts, onValidityChange, name, field }: FieldEditorProps) {
  const i18n = useI18n()
  const cached = drafts?.json.get(path)
  const [draft, setDraft] = useState(() => cached && sameValue(cached.value, value) ? cached : { text: jsonText(value), value, error: false })
  const [reveal, setReveal] = useState(!field.secret)
  const errorId = useId()
  useEffect(() => {
    if (!sameValue(draft.value, value)) setDraft({ text: jsonText(value), value, error: false })
  }, [value, draft.value])
  useEffect(() => { onValidityChange?.(path, !!draft.error); return () => onValidityChange?.(path, false) }, [path, draft.error, onValidityChange])
  if (!reveal) return <div className="space-y-2"><p className="text-xs text-muted-foreground">{i18n.t("敏感值未展示，未编辑时原样保留。")}</p><Button type="button" variant="outline" size="sm" onClick={() => setReveal(true)}>{i18n.t("编辑敏感 JSON")}</Button></div>
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">{field.reason ?? i18n.t("此字段使用 JSON 值编辑；其他字段继续使用表单。")}{field.secret ? i18n.t(" 此项可能包含敏感值，请使用环境变量引用。") : ''}</p><div className="h-44 overflow-hidden rounded-md border"><CodeEditor language="json" ariaLabel={i18n.t("{0} JSON 值", [name])} value={draft.text} invalid={!!draft.error} errorId={draft.error ? errorId : undefined} onChange={text => {
    let next: typeof draft
    try { const parsed = JSON.parse(text); next = { text, value: parsed, error: false }; onChange(parsed) }
    catch { next = { text, value, error: true } }
    onValidityChange?.(path, !!next.error); drafts?.json.set(path, next); setDraft(next)
  }} /></div>{draft.error && <p id={errorId} role="alert" className="text-xs text-destructive">{i18n.t("JSON 格式有误；草稿已保留，修正后才能保存。")}</p>}{value === undefined && !draft.text && <p className="text-xs text-muted-foreground">{i18n.t("尚未设置；不编辑时保持省略。")}</p>}</div>
}

function ObjectValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { field, value, onChange, path = '$' } = props
  const [keyDraft, setKeyDraft] = useState(''), [keyError, setKeyError] = useState(false)
  const fields = objectFields(field)
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (!object) return <div className="space-y-2">{value !== undefined && <JsonValueEditor {...props} />}<Button type="button" variant="outline" size="sm" onClick={() => onChange(initialSchemaValue(field))}>{i18n.t("添加对象配置")}</Button></div>
  const dynamic = field.type === 'dict' ? field.inner || { type: 'any' } : field.additional
  const extras = Object.keys(object).filter(key => !Object.hasOwn(fields, key))
  return <div className="space-y-3 border-l pl-3">{Object.entries(fields).map(([key, child]) => <SchemaFieldEditor {...props} key={key} path={`${path}/${JSON.stringify(key)}`} name={key} field={inheritedField(field, child)} value={object[key]} onChange={next => onChange(updateObjectField(object, key, next))} />)}
    {extras.map(key => <SchemaFieldEditor {...props} key={key} path={`${path}/${JSON.stringify(key)}`} name={key} field={inheritedField(field, dynamic || { type: 'any', reason: i18n.t("Schema 未声明此保存字段；原值保留，最终由 Host 校验。") })} value={object[key]} onChange={next => onChange(updateObjectField(object, key, next))} clearable={false} actions={<Button key="remove" type="button" variant="ghost" size="sm" title={i18n.t("删除键 ") + key} onClick={event => { keepGroupState(event); clearEditorDraftSubtree(`${path}/${JSON.stringify(key)}`, props.drafts, props.onValidityChange); onChange(updateObjectField(object, key, undefined)) }}><Trash2 /><span className="sr-only">{i18n.t("删除键 ")}{key}</span></Button>} />)}
    {!Object.keys(fields).length && !extras.length && <p className="text-xs text-muted-foreground">{dynamic ? i18n.t("当前为空对象，可添加键值。") : i18n.t("此项无需配置字段。")}</p>}
    {dynamic && <div className="flex flex-wrap gap-2"><Input aria-label={i18n.t("新增字典键")} value={keyDraft} onChange={event => { setKeyDraft(event.target.value); setKeyError(false) }} /><Button type="button" variant="outline" size="sm" onClick={() => {
      if (!keyDraft || Object.hasOwn(object, keyDraft) || Object.hasOwn(fields, keyDraft) || props.reservedKeys?.includes(keyDraft) || ['__proto__', 'prototype', 'constructor'].includes(keyDraft)) { setKeyError(true); return }
      onChange(updateObjectField(object, keyDraft, initialSchemaValue(dynamic) ?? (dynamic.type === 'string' ? '' : dynamic.type === 'boolean' ? false : null))); setKeyDraft(''); setKeyError(false)
    }}>{i18n.t("添加键值")}</Button></div>}{keyError && <p role="alert" className="text-xs text-destructive">{i18n.t("键不能为空、不能重复或使用保留名称。")}</p>}
  </div>
}

function SequenceValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { value, field, onChange, name, path = '$', drafts, onValidityChange } = props
  const rows = useRef({ next: 0, ids: [] as number[] })
  const items = Array.isArray(value) ? value : []
  const fixed = field.type === 'tuple' ? field.list ?? [] : []
  const indexes = Array.from({ length: Math.max(items.length, fixed.length) }, (_, i) => i)
  while (rows.current.ids.length < indexes.length) rows.current.ids.push(++rows.current.next)
  rows.current.ids.length = indexes.length
  const rowPath = (id: number) => `${path}/row:${id}`
  const remove = (index: number) => {
    const removed = rows.current.ids.splice(index, 1)[0]
    if (removed !== undefined) clearEditorDraftSubtree(rowPath(removed), drafts, onValidityChange)
    onChange(items.filter((_, i) => i !== index))
  }
  // Add lives on the list's own title row (SchemaFieldEditor); each removable row carries its delete on its title row.
  return <div className="space-y-3">{value !== undefined && !Array.isArray(value) && <JsonValueEditor {...props} />}{indexes.map(index => {
    const child = fixed[index] ?? (field.inner || { type: 'any', reason: i18n.t("此位置不在已声明元组中；原值保留，Host 负责校验。") })
    const id = rows.current.ids[index]!
    return <div key={id}><SchemaFieldEditor {...props} path={rowPath(id)} name={i18n.t("{0} 第 {1} 项", [name, index + 1])} field={inheritedField(field, child)} value={items[index]} onChange={next => onChange(updateListItem(items, index, next))} clearable={false} actions={index >= fixed.length ? <Button key="remove" type="button" variant="ghost" size="sm" title={i18n.t("删除此项")} onClick={event => { keepGroupState(event); remove(index) }}><Trash2 /><span className="sr-only">{i18n.t("删除此项")}</span></Button> : undefined} /></div>
  })}{!indexes.length && Array.isArray(value) ? <p className="text-xs text-muted-foreground">{i18n.t("暂无列表项。")}</p> : null}</div>
}

/** The branch is inferred from the schema and the value; there is no user-facing fill-mode control. */
function UnionValueEditor(props: FieldEditorProps) {
  const i18n = useI18n()
  const { field, value, path = '$', drafts, label, actions, name } = props
  const branches = field.list ?? []
  const local = useRef(new Map<string, { selected: number | undefined; values: Map<number, unknown> }>())
  const store = drafts?.unions ?? local.current
  // Inferred once per path so a mid-edit value that briefly matches another branch does not swap the editor; an explicit 撤销/清空 discards it and re-infers.
  // An unset value opens the first fillable branch so the field reads as a normal control; the value stays unset until edited.
  if (!store.has(path)) { const matches = matchingSchemaBranches(branches, value), fillable = branches.findIndex(branch => branch.type !== 'null' && branch.type !== 'constraint'); store.set(path, { selected: matches.length ? matches[0] : value === undefined && fillable >= 0 ? fillable : undefined, values: new Map() }) }
  const selected = store.get(path)!.selected
  const title = label ?? field.title ?? field.key ?? name
  if (selected !== undefined && branches[selected]) {
    const branch = inheritedField(field, branches[selected])
    // The branch renders the key's single title row; it must not repeat the key as a second header.
    return <SchemaFieldEditor {...props} key={selected} path={`${path}/branch:${selected}`} field={{ ...branch, description: branch.description ?? field.description, required: field.required }} label={title} actions={actions} inheritActions />
  }
  return renderFieldShell({ title, required: field.required, actions: actionList(actions), requiredLabel: i18n.t("必填"), children: <>{field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}<JsonValueEditor {...props} path={`${path}/unselected`} /></> })
}

/** Normalizes caller-provided title-row controls into one keyed list. */
function actionList(actions: ReactNode): ReactNode[] { return Array.isArray(actions) ? actions : actions === undefined || actions === null || actions === false ? [] : [actions] }

/** Header controls live inside <summary>; their clicks must never toggle the group. */
function keepGroupState(event?: { preventDefault(): void }) { event?.preventDefault() }

/** One title row per key: name on the left, compact controls on the right. Called as a function so the rendered tree stays plain elements. */
function renderFieldShell({ id, title, required, requiredLabel, actions, collapsible, meta, open, children }: { id?: string; title: ReactNode; required?: boolean; requiredLabel: string; actions: ReactNode[]; collapsible?: boolean; meta?: ReactNode; open?: boolean; children: ReactNode }) {
  const heading = <>{title}{required ? <span className="ml-1 text-destructive">{requiredLabel}</span> : null}</>
  const controls = actions.length ? <span className="console-field-actions" onClick={keepGroupState}>{actions}</span> : null
  if (collapsible) return <details className="console-field-group" open={open || undefined}>
    <summary><span className="text-sm font-medium">{heading}</span>{meta ? <span className="console-field-group-meta">{meta}</span> : null}{controls}</summary>
    <div className="console-field-group-body space-y-2">{children}</div>
  </details>
  return <div className="space-y-2 rounded-md border p-3">
    <div className="console-field-head">{id ? <label htmlFor={id} className="text-sm font-medium">{heading}</label> : <span className="text-sm font-medium">{heading}</span>}{controls}</div>
    {children}
  </div>
}

/** A list whose items are enum choices edits as one checkbox group. */
function multiChoiceOptions(field: SchemaField, locale: ReturnType<typeof useI18n>['locale']) {
  if (field.type !== 'list' || !field.inner) return undefined
  const inner = localizeSchemaField(field.inner, locale)
  const options = inner.options ?? inner.enum?.map(option => ({ label: String(option), value: option }))
  return options?.length ? options : undefined
}

function appendedListItem(field: SchemaField, value: unknown) {
  const items = Array.isArray(value) ? value : []
  const fixed = field.type === 'tuple' ? field.list ?? [] : []
  const inner = field.inner || { type: 'any' }, next = [...items]
  while (next.length < fixed.length) next.push(initialSchemaValue(fixed[next.length]!) ?? null)
  return [...next, initialSchemaValue(inner) ?? (inner.type === 'string' ? '' : inner.type === 'boolean' ? false : null)]
}

const choiceGroupClass = 'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-2'

export function SchemaFieldEditor({ name, field: sourceField, value, onChange, allowEnvironmentReferences = true, path = '$', drafts, onValidityChange, reservedKeys, label, actions, inheritActions, clearable = true }: FieldEditorProps) {
  const i18n = useI18n()
  const field = localizeSchemaField(sourceField, i18n.locale)
  const id = useId()
  const conversationScope = isConversationScopeField(field)
  const numeric = field.type === 'number' || field.type === 'integer'
  const numericIssue = numeric && !(allowEnvironmentReferences && typeof value === 'string' && value.includes('${')) ? numericFieldIssue({ ...field, integer: field.integer || field.type === 'integer' }, value, i18n.locale) : null
  if (field.hidden) return null
  // The first value seen for a path is what 撤销 restores; the form clears this baseline whenever it reloads the saved config.
  if (drafts?.originals && !drafts.originals.has(path)) drafts.originals.set(path, value === undefined ? undefined : structuredClone(value))
  const secret = field.secret || field.component === 'password'
  const constUnion = field.type === 'union' && !!field.list?.length && field.list.every(branch => branch.type === 'const')
  const options = field.options ?? field.enum?.map(option => ({ label: String(option), value: option }))
    ?? (constUnion ? field.list!.map(branch => { const localized = localizeSchemaField(branch, i18n.locale), constant = Object.hasOwn(localized, 'value') ? localized.value : localized.default; return { label: localized.title ?? JSON.stringify(constant), value: constant } }) : undefined)
  const optionIndex = options?.findIndex(option => JSON.stringify(option.value) === JSON.stringify(value)) ?? -1
  const preservedOption = !!options?.length && value !== undefined && optionIndex < 0
  const environmentOption = allowEnvironmentReferences && typeof value === 'string' && value.includes('${')
  const preservedLabel = environmentOption ? i18n.t("环境变量引用（原样保留）") : i18n.t("现有值不在选项中（原样保留）")
  const nested = { name, field: secret ? { ...field, secret: true } : field, value, onChange, allowEnvironmentReferences, path, drafts, onValidityChange, reservedKeys }
  const title = label ?? field.title ?? field.key ?? name
  const hasDefault = Object.hasOwn(field, 'default')
  const choices = conversationScope ? undefined : multiChoiceOptions(field, i18n.locale)
  const sequence = !conversationScope && !choices && (field.type === 'list' || field.type === 'tuple')
  const canAppend = sequence && (field.type === 'list' || !!field.inner) && (value === undefined || Array.isArray(value))
  const editable = !conversationScope && !['const', 'constraint'].includes(field.type)
  // Value controls: 撤销 restores the baseline (saved value, or the declared default it was filled from); 清空 leaves the key unset.
  const valueActions: ReactNode[] = []
  if (!inheritActions && editable) {
    const original = drafts?.originals?.get(path)
    if (drafts?.originals?.has(path) && !sameValue(value, original)) valueActions.push(<Button key="revert" type="button" variant="ghost" size="sm" title={i18n.t("撤销修改，恢复原值或默认值")} onClick={event => { keepGroupState(event); clearEditorDraftSubtree(path, drafts, onValidityChange); onChange(original === undefined ? undefined : structuredClone(original)) }}><Undo2 /><span className="sr-only sm:not-sr-only">{i18n.t("撤销")}</span></Button>)
    if (clearable && value !== undefined) valueActions.push(<Button key="clear" type="button" variant="ghost" size="sm" title={hasDefault ? i18n.t("清空（使用声明默认值）") : i18n.t("清空（保存时省略此项）")} onClick={event => { keepGroupState(event); clearEditorDraftSubtree(path, drafts, onValidityChange); onChange(undefined) }}><Eraser /><span className="sr-only sm:not-sr-only">{i18n.t("清空")}</span></Button>)
  }
  if (field.type === 'union' && !conversationScope && !constUnion) return <UnionValueEditor {...nested} label={title} actions={[...valueActions, ...actionList(actions)]} />
  const contentActions: ReactNode[] = []
  if (canAppend) contentActions.push(<Button key="add" type="button" variant="outline" size="sm" title={i18n.t("添加列表项")} onClick={event => { keepGroupState(event); event?.currentTarget?.closest('details')?.setAttribute('open', ''); onChange(appendedListItem(field, value)) }}><Plus /><span className="sr-only sm:not-sr-only">{i18n.t("添加列表项")}</span></Button>)
  const passed = actionList(actions)
  // Title row holds only buttons; a union branch reuses the union's value controls instead of its own.
  const headerActions = [...contentActions, ...(inheritActions ? [] : valueActions), ...passed]
  const textInput = !options?.length && (field.type === 'string' || field.component === 'textarea') && (value === undefined || typeof value === 'string')
  const textPlaceholder = allowEnvironmentReferences ? secret ? i18n.t("建议使用环境变量引用，如 ${API_KEY}") : i18n.t("文本，或 ${ENV_NAME} 引用环境变量") : undefined
  const selectedChoices = Array.isArray(value) ? value : []
  const unknownChoices = choices ? selectedChoices.filter(item => !choices.some(option => sameValue(option.value, item))) : []
  const content = <>
    {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
    {hasDefault ? <p className="text-xs text-muted-foreground">{secret ? i18n.t("已声明默认值") : i18n.t("声明默认值：{0}", [JSON.stringify(field.default)])}</p> : null}
    {secret && !textInput ? <p className="text-xs text-muted-foreground">{allowEnvironmentReferences ? <>{i18n.t("建议填写环境变量引用，如 ")}{'${API_KEY}'}{i18n.t("；不要将密钥写入配置。")}</> : i18n.t("请按任务提供方要求填写；此处不解析环境变量引用。")}</p> : null}
    {conversationScope ? <ConversationScopeEditor field={field} value={value} onChange={onChange} /> : field.type === 'constraint' ? <p className="text-xs text-muted-foreground">{i18n.t("此约束不提供额外输入；提交后由 Host 校验，不在此处推断通过。")}</p> : field.type === 'intersect' ? <div className="space-y-3"><p className="text-xs text-muted-foreground">{i18n.t("所有约束共同适用；各组编辑同一份值，Host 最终校验。")}</p>{(field.list ?? []).map((branch, index) => <SchemaFieldEditor {...nested} key={index} path={`${path}/intersect:${index}`} field={inheritedField(field, branch)} name={branch.title ?? i18n.t("{0} 约束 {1}", [name, index + 1])} />)}</div> : options?.length ? <RadioGroup id={id} aria-label={title} className={choiceGroupClass} value={preservedOption ? 'preserved' : value === undefined ? '' : String(optionIndex)} onValueChange={index => {
      if (!/^(0|[1-9]\d*)$/.test(index)) return
      const option = options[Number(index)]
      if (option) onChange(structuredClone(option.value))
    }}>{options.map((option, index) => <label key={index} className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value={String(index)} />{option.label}</label>)}</RadioGroup>
      : choices ? value !== undefined && !Array.isArray(value) ? <JsonValueEditor {...nested} /> : <><div id={id} role="group" aria-label={title} className={choiceGroupClass}>{choices.map((option, index) => <label key={index} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={selectedChoices.some(item => sameValue(item, option.value))} onCheckedChange={checked => onChange([...choices.filter(candidate => candidate === option ? checked === true : selectedChoices.some(item => sameValue(item, candidate.value))).map(candidate => structuredClone(candidate.value)), ...unknownChoices])} />{option.label}</label>)}</div>{unknownChoices.length ? <p className="text-xs text-muted-foreground">{i18n.t("另有 {0} 个保存值不在选项中，将原样保留。", [unknownChoices.length])}</p> : null}</>
      : field.type === 'object' || field.type === 'dict' ? <ObjectValueEditor {...nested} /> : field.type === 'list' || field.type === 'tuple' ? <SequenceValueEditor {...nested} /> : field.type === 'boolean' ? <>{value !== undefined && typeof value !== 'boolean' ? <><p className="text-xs text-muted-foreground">{i18n.t("已保存非布尔原值；不操作时保留。可在下方编辑，或明确使用开关替换。")}</p><JsonValueEditor {...nested} /></> : null}<div><Switch id={id} aria-label={title} checked={value === true} onCheckedChange={onChange} /></div></>
      : field.type === 'const' ? <div className="space-y-2"><p id={id} className="text-sm">{secret ? i18n.t("固定值未展示；当前原值保持不变。") : <>{i18n.t("当前：")}{JSON.stringify(value) ?? i18n.t("未设置")}{i18n.t("；固定值：")}{JSON.stringify(Object.hasOwn(field, 'value') ? field.value : field.default)}</>}</p>{!sameValue(value, Object.hasOwn(field, 'value') ? field.value : field.default) && <Button type="button" variant="outline" size="sm" onClick={() => onChange(structuredClone(Object.hasOwn(field, 'value') ? field.value : field.default))}>{i18n.t("使用固定值")}</Button>}</div>
      : field.type === 'null' ? <div className="space-y-2"><p>{i18n.t("当前：")}{secret && value !== null && value !== undefined ? i18n.t("敏感原值未展示") : JSON.stringify(value) ?? i18n.t("未设置")}</p>{value !== null && <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>{i18n.t("设为 null")}</Button>}</div>
      : field.type === 'number' || field.type === 'integer' ? value !== undefined && typeof value !== 'number' && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : <Input id={id} type={field.secret ? 'password' : 'text'} aria-invalid={!!numericIssue} inputMode="decimal" value={value === undefined ? '' : String(value)} onChange={event => onChange(numericDraft(event.target.value))} placeholder={allowEnvironmentReferences ? i18n.t("数字或 ${ENV_NAME}") : i18n.t("填写数字")} />
      : field.component === 'textarea' ? value !== undefined && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : secret ? <SecretTextEditor {...nested} id={id} placeholder={textPlaceholder} /> : <Textarea id={id} placeholder={textPlaceholder} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} />
      : field.type === 'string' ? value !== undefined && typeof value !== 'string' ? <JsonValueEditor {...nested} /> : <Input id={id} type={field.secret || field.component === 'password' ? 'password' : 'text'} autoComplete="off" placeholder={textPlaceholder} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value)} /> : <JsonValueEditor {...nested} />}
    {preservedOption ? <p className="break-all text-xs text-muted-foreground"><span className="font-medium">{preservedLabel}</span>{' · '}{environmentOption ? i18n.t("当前为环境变量引用，展开值未读取。") : <>{i18n.t("当前保存值不在选项中")}{secret ? '。' : `：${JSON.stringify(value)?.slice(0, 200)}${(JSON.stringify(value)?.length ?? 0) > 200 ? '…' : ''}。`}</>}{i18n.t("未选择替换时会原样保留；可明确选择新值，或打开完整源码编辑。保存仍需 Host 校验。")}</p> : null}
    {numericIssue ? <p role="alert" className="text-xs text-destructive">{numericIssue}{i18n.t("；以 Host 校验结果为准。")}</p> : null}
  </>
  const collapsible = !conversationScope && !choices && ['object', 'dict', 'list', 'tuple'].includes(field.type)
  if (collapsible) {
    const entries = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
    const declared = Object.keys(objectFields(field)).length
    // Open only when something here still needs input; otherwise the summary line is enough to scan.
    const needsInput = field.required && value === undefined
    const meta = <>{field.type === 'list' || field.type === 'tuple' ? i18n.t("{0} 项", [entries]) : declared ? i18n.t("{0} 个字段 · 已设置 {1}", [declared, entries]) : i18n.t("已设置 {0}", [entries])}{value === undefined ? ` · ${i18n.t("尚未设置")}` : ''}</>
    return renderFieldShell({ title, required: field.required, requiredLabel: i18n.t("必填"), actions: headerActions, collapsible: true, meta, open: needsInput, children: content })
  }
  return renderFieldShell({ id, title, required: field.required, requiredLabel: i18n.t("必填"), actions: headerActions, children: content })
}
